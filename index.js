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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DOMAIN = "https://whatsapp-bot-production-5f72.up.railway.app";

const allowedTimes = ["14:00","15:00","16:00","17:00","18:00","19:30"];

const conversations = {};

/* =======================
DATA BRASIL
======================= */

function getBrazilDate(){
  return new Date(new Date().toLocaleString("en-US",{timeZone:"America/Sao_Paulo"}));
}

function nextAvailableDate(){
  let d = getBrazilDate();
  d.setDate(d.getDate()+5);

  while(d.getDay()===0 || d.getDay()===1 || d.getDay()===6){
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

/* =======================
DETECTAR NOME
======================= */

function detectName(msg){

  const match = msg.match(/meu nome é ([A-Za-zÀ-ú]+)/i) ||
                msg.match(/me chamo ([A-Za-zÀ-ú]+)/i) ||
                msg.match(/sou a ([A-Za-zÀ-ú]+)/i) ||
                msg.match(/sou o ([A-Za-zÀ-ú]+)/i);

  if(match) return match[1];

  return null;

}

/* =======================
DETECTAR PROCEDIMENTO
======================= */

function detectProcedure(msg){

  const t = msg.toLowerCase();

  if(t.includes("botox") || t.includes("ruga") || t.includes("testa"))
  return "botox";

  if(t.includes("lábio") || t.includes("labio") || t.includes("preenchimento"))
  return "preenchimento";

  if(t.includes("papada"))
  return "lipo de papada";

  if(t.includes("vaso") || t.includes("microvaso"))
  return "microvasos";

  if(t.includes("mancha") || t.includes("melasma"))
  return "tratamento de manchas";

  if(t.includes("flacidez"))
  return "bioestimulador";

  return null;

}

/* =======================
CLASSIFICAR LEAD
======================= */

function classifyLead(msg){

  const t = msg.toLowerCase();

  if(
    t.includes("quero fazer") ||
    t.includes("quero agendar") ||
    t.includes("tem horário")
  ) return "quente";

  if(
    t.includes("quanto custa") ||
    t.includes("valor") ||
    t.includes("preço")
  ) return "frio";

  return "morno";

}

/* =======================
OBJEÇÕES
======================= */

function detectFear(msg){

  const t = msg.toLowerCase();

  return t.includes("artificial") || t.includes("exagerado");

}

function detectPriceCompare(msg){

  const t = msg.toLowerCase();

  return t.includes("mais barato") || t.includes("caro");

}

/* =======================
ÁUDIO
======================= */

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
  const writer=fs.createWriteStream(path);
  response.data.pipe(writer);

  return new Promise(resolve=>{
    writer.on("finish",()=>resolve(path));
  });

}

async function transcribeAudio(path){

  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(path),
    model:"gpt-4o-transcribe"
  });

  return transcription.text;

}

async function generateVoice(text){

  const speech = await openai.audio.speech.create({
    model:"gpt-4o-mini-tts",
    voice:"alloy",
    input:text
  });

  const buffer = Buffer.from(await speech.arrayBuffer());
  fs.writeFileSync("./audio/reply.mp3",buffer);

}

/* =======================
FOLLOW UP
======================= */

async function sendWhatsAppMessage(to,text){

  const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;

  await axios.post(url,new URLSearchParams({
    From: "whatsapp:+14155238886",
    To: to,
    Body: text
  }),{
    auth:{
      username:process.env.TWILIO_ACCOUNT_SID,
      password:process.env.TWILIO_AUTH_TOKEN
    }
  });

}

function scheduleFollowUps(user,phone){

  if(user.followupsScheduled) return;

  user.followupsScheduled = true;

  setTimeout(()=>{
    sendWhatsAppMessage(phone,"Oi 😊 Vi que você estava vendo sobre o procedimento. Se quiser posso verificar um horário para avaliação.");
  },30*60*1000);

  setTimeout(()=>{
    sendWhatsAppMessage(phone,"A agenda do Dr. Henrique Mafra costuma ficar bem concorrida. Se quiser posso verificar disponibilidade para você.");
  },2*60*60*1000);

  setTimeout(()=>{
    sendWhatsAppMessage(phone,"Se ainda tiver interesse no procedimento, fico à disposição para ajudar com o agendamento.");
  },24*60*60*1000);

}

/* =======================
IA
======================= */

async function aiReply(history,nextDateText){

  const completion = await openai.chat.completions.create({

    model:"gpt-4o-mini",

    messages:[
      {
        role:"system",
        content:`
Você é a assistente da clínica do Dr Henrique Mafra.

Converse como uma atendente real.

Nunca falar valores.

Sempre conduzir para avaliação.

Sugira primeiro o horário das 19h30.

Data mínima disponível:
${nextDateText}

Horários disponíveis:
14h
15h
16h
17h
18h
19h30

Respostas curtas e naturais.
`
      },

      ...history

    ]

  });

  return completion.choices[0].message.content;

}

/* =======================
ROTA WHATSAPP
======================= */

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
        nome:null,
        procedimento:null,
        lead:null
      };
    }

    const user = conversations[from];

    const name = detectName(message);
    if(name) user.nome=name;

    const procedure = detectProcedure(message);
    if(procedure) user.procedimento=procedure;

    user.lead = classifyLead(message);

    user.history.push({
      role:"user",
      content:message
    });

    if(detectFear(message)){
      const reply="Isso é uma preocupação muito comum 😊 O objetivo do Dr Henrique Mafra é sempre manter naturalidade no resultado.";
      return res.type("text/xml").send(`<Response><Message>${reply}</Message></Response>`);
    }

    if(detectPriceCompare(message)){
      const reply="Na clínica do Dr Henrique Mafra o foco é segurança e naturalidade no resultado. Cada caso passa por avaliação personalizada.";
      return res.type("text/xml").send(`<Response><Message>${reply}</Message></Response>`);
    }

    const nextDateText = formatDate(nextAvailableDate());

    const reply = await aiReply(user.history,nextDateText);

    user.history.push({
      role:"assistant",
      content:reply
    });

    scheduleFollowUps(user,from);

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

    res.type("text/xml").send(`<Response><Message>${reply}</Message></Response>`);

  }
  catch(err){

    console.log(err);

    res.type("text/xml").send(`
<Response>
<Message>
Tive uma instabilidade agora 😅 Pode me enviar novamente sua mensagem?
</Message>
</Response>
`);

  }

});

const PORT = process.env.PORT || 8080;

app.listen(PORT,()=>{
  console.log("Servidor rodando");
});
