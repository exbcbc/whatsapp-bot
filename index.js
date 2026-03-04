import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";

dotenv.config();

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use("/audio", express.static("./audio"));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const DOMAIN = "https://whatsapp-bot-production-5f72.up.railway.app";

const conversations = {};

const allowedTimes = [
"14:00","15:00","16:00","17:00","18:00","19:30"
];

/* ========================
DATA BRASIL
======================== */

function getBrazilDate(){

  return new Date(
    new Date().toLocaleString("en-US",{timeZone:"America/Sao_Paulo"})
  );

}

function nextAvailableDate(){

  let d = getBrazilDate();

  d.setDate(d.getDate()+5);

  while(
    d.getDay()===0 ||
    d.getDay()===1 ||
    d.getDay()===6
  ){
    d.setDate(d.getDate()+1);
  }

  return d;

}

function formatDate(date){

  return date.toLocaleDateString("pt-BR",{
    weekday:"long",
    day:"numeric",
    month:"long",
    year:"numeric",
    timeZone:"America/Sao_Paulo"
  });

}

/* ========================
PROCEDIMENTO
======================== */

function detectProcedure(msg){

  const t = msg.toLowerCase();

  if(t.includes("botox") || t.includes("ruga") || t.includes("testa"))
  return "botox";

  if(t.includes("lábio") || t.includes("labio") || t.includes("preenchimento"))
  return "preenchimento";

  if(t.includes("papada"))
  return "papada";

  if(t.includes("vaso") || t.includes("microvaso"))
  return "microvasos";

  if(t.includes("mancha") || t.includes("melasma"))
  return "manchas";

  return null;

}

/* ========================
LEAD
======================== */

function classifyLead(msg){

  const t = msg.toLowerCase();

  if(
    t.includes("quero fazer") ||
    t.includes("quero agendar") ||
    t.includes("tem horário") ||
    t.includes("marcar consulta")
  )
  return "quente";

  if(
    t.includes("quanto custa") ||
    t.includes("valor") ||
    t.includes("preço")
  )
  return "frio";

  return "morno";

}

/* ========================
DOWNLOAD AUDIO
======================== */

async function downloadAudio(url){

  const response = await axios({
    url,
    method:"GET",
    responseType:"stream",
    auth:{
      username:process.env.TWILIO_ACCOUNT_SID,
      password:process.env.TWILIO_AUTH_TOKEN
    }
  });

  const path="./audio/input.ogg";

  const writer = fs.createWriteStream(path);

  response.data.pipe(writer);

  return new Promise(resolve=>{
    writer.on("finish",()=>resolve(path));
  });

}

/* ========================
TRANSCRIÇÃO
======================== */

async function transcribeAudio(path){

  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(path),
    model:"gpt-4o-transcribe"
  });

  return transcription.text;

}

/* ========================
GERAR VOZ
======================== */

async function generateVoice(text){

  const speech = await openai.audio.speech.create({
    model:"gpt-4o-mini-tts",
    voice:"alloy",
    input:text
  });

  const buffer = Buffer.from(await speech.arrayBuffer());

  fs.writeFileSync("./audio/reply.mp3",buffer);

}

/* ========================
IA
======================== */

async function aiReply(history,nextDateText){

  const completion = await openai.chat.completions.create({

    model:"gpt-4o-mini",

    messages:[

      {
        role:"system",
        content:`
Você é a assistente da clínica do Dr Henrique Mafra.

Converse como uma atendente real de WhatsApp.

Nunca assinar mensagens.

Nunca parecer robô.

Nunca falar valores de procedimentos.

Sempre conduzir para avaliação presencial.

Data mínima para agendamento:
${nextDateText}

Horário preferencial:
19h30

Horários possíveis:
14h
15h
16h
17h
18h
19h30

Sempre sugerir primeiro 19h30 de forma natural.

Respostas curtas.

Tom simpático e humano.
`
      },

      ...history

    ]

  });

  return completion.choices[0].message.content;

}

/* ========================
ROTA WHATSAPP
======================== */

app.post("/whatsapp", async(req,res)=>{

  try{

    const from = req.body.From;

    const hasAudio = req.body.NumMedia && req.body.NumMedia>0;

    let message = req.body.Body || "";

    if(hasAudio){

      const mediaUrl=req.body.MediaUrl0;

      const path=await downloadAudio(mediaUrl);

      message = await transcribeAudio(path);

    }

    if(!conversations[from]){

      conversations[from]={
        history:[],
        procedure:null,
        lead:null
      };

    }

    const user = conversations[from];

    user.history.push({
      role:"user",
      content:message
    });

    const procedure = detectProcedure(message);
    if(procedure) user.procedure = procedure;

    const lead = classifyLead(message);
    user.lead = lead;

    const nextDate = nextAvailableDate();

    const nextDateText = formatDate(nextDate);

    const reply = await aiReply(user.history,nextDateText);

    user.history.push({
      role:"assistant",
      content:reply
    });

    if(hasAudio){

      await generateVoice(reply);

      return res.type("text/xml").send(`
<Response>
<Message>
<Body>${reply}</Body>
<Media>${DOMAIN}/audio/reply.mp3</Media>
</Message>
</Response>
`);

    }

    res.type("text/xml").send(`
<Response>
<Message>${reply}</Message>
</Response>
`);

  }

  catch(err){

    console.log(err);

    res.type("text/xml").send(`
<Response>
<Message>
Tive uma instabilidade agora 😅
Pode me enviar novamente sua mensagem?
</Message>
</Response>
`);

  }

});

const PORT = process.env.PORT || 8080;

app.listen(PORT,()=>{
  console.log("Servidor rodando");
});
