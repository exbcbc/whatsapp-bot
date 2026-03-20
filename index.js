import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";

dotenv.config();

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

if (!fs.existsSync("./media")) {
  fs.mkdirSync("./media");
}

app.use("/media", express.static("./media"));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const DOMAIN = "https://whatsapp-bot-production-5f72.up.railway.app";

const CLINIC_PHONE = "whatsapp:+554731700136";
const ADMIN_PHONE = "whatsapp:+5547991812557";
const INSTAGRAM = "@dr.henriquemafra";

const CLINIC_ADDRESS = `
Clínica WF
Rua 981, Número 196
Centro em Balneário Camboriú, Santa Catarina
`;

const DOCTOR_PHONE = "47 99188-6417";

const conversations = {};

// ================= DATA =================

function getBrazilDate() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

function nextAvailableDates() {
  let dates = [];
  let d = getBrazilDate();
  d.setDate(d.getDate() + 5);

  while (dates.length < 3) {
    if (d.getDay() !== 0 && d.getDay() !== 1 && d.getDay() !== 6) {
      dates.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }

  return dates;
}

function formatDate(date) {
  return date.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });
}

// ================= TWILIO =================

async function sendWhatsAppMessage(to, text) {
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;

    await axios.post(url, new URLSearchParams({
      From: CLINIC_PHONE,
      To: to,
      Body: text
    }), {
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN
      }
    });

  } catch (e) {
    console.log("Erro mensagem:", e.message);
  }
}

// ================= IA =================

function isExistingPatient(message) {
  const text = (message || "").toLowerCase();
  return text.includes("já sou paciente") || text.includes("ja sou paciente");
}

async function aiReply(history) {

  const dates = nextAvailableDates();

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `
Você é Iara, assistente virtual da clínica Dr Henrique Mafra.

REGRAS IMPORTANTES:
- Nunca fale de política, prefeito ou assuntos fora da clínica
- Nunca invente coisas
- Seja profissional, simpática e objetiva
- Sempre conduza para agendamento

FLUXO:
1. Cumprimente
2. Pergunte o procedimento
3. Explique breve
4. Ofereça agendamento

Procedimentos:
Toxina botulínica
HIFU
Fios de PDO
Preenchimento
Lipo de papada
Remoção de verrugas

Consulta: R$150

Horários disponíveis:
${formatDate(dates[0])} às 19h30
${formatDate(dates[1])} às 19h30
${formatDate(dates[2])} às 19h30

Se não puder:
"Qual horário à tarde você prefere?"

Telefone:
${DOCTOR_PHONE}

Endereço:
${CLINIC_ADDRESS}

Respostas curtas e naturais.
`
      },
      ...history
    ]
  });

  return completion.choices[0].message.content;
}

// ================= WHATSAPP =================

app.post("/whatsapp", async (req, res) => {

  res.send("ok");

  const from = req.body.From;
  const message = req.body.Body || "";

  if (!conversations[from]) {
    conversations[from] = { history: [] };
  }

  const user = conversations[from];

  user.history.push({ role: "user", content: message });

  const reply = await aiReply(user.history);

  user.history.push({ role: "assistant", content: reply });

  await sendWhatsAppMessage(from, reply);

  await sendWhatsAppMessage(ADMIN_PHONE, `💬 ${from}\n${message}`);
  await sendWhatsAppMessage(ADMIN_PHONE, `🤖 ${reply}`);

});

// ================= VOICE =================

app.post("/voice", (req, res) => {

  res.type("text/xml");

  res.send(`
<Response>
  <Say language="pt-BR">
    Olá, aqui é a Iara da clínica Dr Henrique Mafra. Como posso ajudar?
  </Say>
  <Gather input="speech" action="/processar" method="POST" language="pt-BR"/>
</Response>
  `);

});

app.post("/processar", async (req, res) => {

  const from = req.body.From || "unknown";
  const fala = req.body.SpeechResult || "";

  if (!fala) {
    res.type("text/xml");
    return res.send(`
<Response>
  <Say language="pt-BR">Pode repetir?</Say>
  <Gather input="speech" action="/processar" method="POST" language="pt-BR"/>
</Response>
    `);
  }

  if (!conversations[from]) {
    conversations[from] = { history: [] };
  }

  const user = conversations[from];

  user.history.push({ role: "user", content: fala });

  const reply = await aiReply(user.history);

  user.history.push({ role: "assistant", content: reply });

  await sendWhatsAppMessage(ADMIN_PHONE, `📞 ${from}\n${fala}`);
  await sendWhatsAppMessage(ADMIN_PHONE, `🤖 ${reply}`);

  res.type("text/xml");

  res.send(`
<Response>
  <Say language="pt-BR">${reply}</Say>
  <Gather input="speech" action="/processar" method="POST" language="pt-BR"/>
</Response>
  `);

});

// ================= START =================

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("Servidor rodando");
});
