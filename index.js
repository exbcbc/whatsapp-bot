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

const conversations = {};

/* =========================
DATA BRASIL
========================= */

function getBrazilDate() {
  return new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "America/Sao_Paulo"
    })
  );
}

/* =========================
PRÓXIMO DIA DISPONÍVEL
========================= */

function getNextAvailableDate() {

  let date = getBrazilDate();

  date.setDate(date.getDate() + 5);

  while (
    date.getDay() === 0 ||
    date.getDay() === 1 ||
    date.getDay() === 6
  ) {
    date.setDate(date.getDate() + 1);
  }

  return date;
}

/* =========================
FORMATAR DATA
========================= */

function formatDate(date) {

  return date.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });

}

/* =========================
EXTRAIR NOME
========================= */

function extractName(message) {

  const patterns = [
    /me chamo\s+([a-zA-ZÀ-ú]+)/i,
    /meu nome é\s+([a-zA-ZÀ-ú]+)/i,
    /sou a\s+([a-zA-ZÀ-ú]+)/i,
    /sou o\s+([a-zA-ZÀ-ú]+)/i
  ];

  for (let p of patterns) {

    const match = message.match(p);

    if (match) return match[1];

  }

  return null;

}

/* =========================
EXTRAIR HORÁRIO
========================= */

function extractTime(text) {

  const match = text.match(/\b([01]?\d|2[0-3])[:h]?([0-5]\d)?/);

  if (!match) return null;

  let hour = match[1].padStart(2, "0");
  let minute = match[2] ? match[2] : "00";

  return `${hour}:${minute}`;

}

/* =========================
DETECTAR PREÇO
========================= */

function priceIntent(text) {

  const t = text.toLowerCase();

  return (
    t.includes("valor") ||
    t.includes("preço") ||
    t.includes("quanto custa") ||
    t.includes("custa quanto")
  );

}

/* =========================
DOWNLOAD ÁUDIO
========================= */

async function downloadAudio(url) {

  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
    auth: {
      username: process.env.TWILIO_ACCOUNT_SID,
      password: process.env.TWILIO_AUTH_TOKEN
    }
  });

  const path = "./audio/audio.ogg";

  const writer = fs.createWriteStream(path);

  response.data.pipe(writer);

  return new Promise((resolve) => {
    writer.on("finish", () => resolve(path));
  });

}

/* =========================
TRANSCRIÇÃO
========================= */

async function transcribeAudio(path) {

  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(path),
    model: "gpt-4o-transcribe"
  });

  return transcription.text;

}

/* =========================
GERAR ÁUDIO
========================= */

async function generateVoice(text) {

  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    input: text
  });

  const buffer = Buffer.from(await speech.arrayBuffer());

  const file = "./audio/reply.mp3";

  fs.writeFileSync(file, buffer);

  return file;

}

/* =========================
ROTA WHATSAPP
========================= */

app.post("/whatsapp", async (req, res) => {

  try {

    const from = req.body.From;

    const hasAudio = req.body.NumMedia && req.body.NumMedia > 0;

    let incomingMessage = req.body.Body || "";

    if (hasAudio) {

      const mediaUrl = req.body.MediaUrl0;

      const audioPath = await downloadAudio(mediaUrl);

      incomingMessage = await transcribeAudio(audioPath);

    }

    if (!conversations[from]) {

      conversations[from] = {
        history: [],
        name: null
      };

    }

    const user = conversations[from];

    const detectedName = extractName(incomingMessage);

    if (detectedName) user.name = detectedName;

    user.history.push({
      role: "user",
      content: incomingMessage
    });

    const nextDate = getNextAvailableDate();

    const nextDateText = formatDate(nextDate);

    if (priceIntent(incomingMessage)) {

      const reply = `Entendo sua dúvida 😊

Como cada caso exige uma avaliação personalizada, os valores são informados somente após análise do profissional.

O Dr. Henrique Mafra trabalha com protocolos individualizados para garantir o melhor resultado.

Se quiser, posso verificar um horário para avaliação.

Equipe Dr. Henrique Mafra`;

      return res.type("text/xml").send(`
<Response>
<Message>${reply}</Message>
</Response>
`);

    }

    const detectedTime = extractTime(incomingMessage);

    if (detectedTime) {

      const reply = `Perfeito${user.name ? ", " + user.name : ""} 😊

Seu horário ficou reservado para ${nextDateText} às ${detectedTime}.

Caso precise alterar, é só avisar.

Endereço da clínica:
Clínica WF
Rua 981, 196
Centro
Balneário Camboriú

Equipe Dr. Henrique Mafra`;

      return res.type("text/xml").send(`
<Response>
<Message>${reply}</Message>
</Response>
`);

    }

    const completion = await openai.chat.completions.create({

      model: "gpt-4o-mini",

      messages: [

        {
          role: "system",
          content: `
Você é assistente da clínica do Dr. Henrique Mafra.

Local:
Clínica WF
Rua 981 nº196
Centro
Balneário Camboriú

Horário de atendimento:
Terça a sexta
14h às 20h

Nunca informar valores.

Sempre sugerir avaliação.

Data mínima disponível:
${nextDateText}

Horários possíveis:
14h
15h
16h
17h
18h
19h30

Respostas curtas e naturais de WhatsApp.

Finalize sempre com:

Equipe Dr. Henrique Mafra
`
        },

        ...user.history

      ]

    });

    const reply = completion.choices[0].message.content;

    user.history.push({
      role: "assistant",
      content: reply
    });

    if (hasAudio) {

      await generateVoice(reply);

      return res.type("text/xml").send(`
<Response>
<Message>
<Body>${reply}</Body>
<Media>https://whatsapp-bot-production-5f72.up.railway.app/audio/reply.mp3</Media>
</Message>
</Response>
`);

    }

    res.type("text/xml").send(`
<Response>
<Message>${reply}</Message>
</Response>
`);

  } catch (error) {

    console.log(error);

    res.type("text/xml").send(`
<Response>
<Message>Desculpe, tive uma instabilidade. Pode me enviar novamente sua mensagem? 😊</Message>
</Response>
`);

  }

});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("Servidor rodando");
});
