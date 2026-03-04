import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =========================
MEMÓRIA
========================= */

const conversations = {};

/* =========================
HORÁRIOS PERMITIDOS
========================= */

const allowedTimes = [
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:30"
];

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

function getNextBusinessDay() {

  let date = getBrazilDate();

  date.setDate(date.getDate() + 5);

  while (
    date.getDay() === 0 || // domingo
    date.getDay() === 1 || // segunda
    date.getDay() === 6    // sábado
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
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

/* =========================
DETECTAR HORÁRIO
========================= */

function extractTime(text) {

  const match = text.match(/\b([01]?\d|2[0-3])[:h]?([0-5]\d)?/);

  if (!match) return null;

  let hour = match[1].padStart(2, "0");
  let minute = match[2] ? match[2] : "00";

  return `${hour}:${minute}`;
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
OBJEÇÃO DE PREÇO
========================= */

function isPriceObjection(text) {

  const t = text.toLowerCase();

  return (
    t.includes("valor") ||
    t.includes("preço") ||
    t.includes("quanto custa") ||
    t.includes("custa quanto") ||
    t.includes("parcel")
  );
}

/* =========================
CONFIRMAÇÃO
========================= */

function isConfirmation(text) {

  const t = text.toLowerCase();

  return (
    t.includes("confirmo") ||
    t.includes("pode marcar") ||
    t.includes("ok pode") ||
    t.includes("fechado")
  );
}

/* =========================
ROTA WHATSAPP
========================= */

app.post("/whatsapp", async (req, res) => {

  try {

    const message = req.body.Body;
    const from = req.body.From;

    if (!conversations[from]) {

      conversations[from] = {
        history: [],
        name: null,
        date: null
      };

    }

    const user = conversations[from];

    /* salvar nome */

    const name = extractName(message);

    if (name) user.name = name;

    user.history.push({
      role: "user",
      content: message
    });

    const nextDate = getNextBusinessDay();
    const nextDateText = formatDate(nextDate);

    /* objeção preço */

    if (isPriceObjection(message)) {

      const reply = `${user.name ? user.name + ", " : ""}entendo sua dúvida 😊

Como cada caso exige uma avaliação individual, os valores são definidos somente após analisarmos suas necessidades.

O Dr. Henrique Mafra trabalha com protocolos personalizados para garantir naturalidade e segurança.

Se quiser, posso verificar uma data para avaliarmos seu caso com calma.

Equipe Dr. Henrique Mafra`;

      return res.type("text/xml").send(`
<Response>
<Message>${reply}</Message>
</Response>
`);
    }

    /* detectar horário */

    const detectedTime = extractTime(message);

    if (detectedTime) {

      if (!allowedTimes.includes(detectedTime)) {

        const reply = `Nesse horário não temos atendimento.

Os horários disponíveis são:

14h  
15h  
16h  
17h  
18h  
19h30

Qual deles funciona melhor para você?`;

        return res.type("text/xml").send(`
<Response>
<Message>${reply}</Message>
</Response>
`);
      }

      user.date = nextDateText;

      const reply = `Perfeito${user.name ? ", " + user.name : ""} 😊

Seu horário ficou reservado para ${nextDateText} às ${detectedTime}.

Qualquer imprevisto, nos avise com antecedência.

Equipe Dr. Henrique Mafra`;

      return res.type("text/xml").send(`
<Response>
<Message>${reply}</Message>
</Response>
`);
    }

    /* confirmação */

    if (isConfirmation(message)) {

      const reply = `Perfeito${user.name ? ", " + user.name : ""} 😊

Seu horário ficou reservado para ${nextDateText} às 19h30.

Equipe Dr. Henrique Mafra`;

      return res.type("text/xml").send(`
<Response>
<Message>${reply}</Message>
</Response>
`);
    }

    /* IA NORMAL */

    const completion = await openai.chat.completions.create({

      model: "gpt-4o-mini",

      messages: [

        {
          role: "system",
          content: `
Você é a assistente da clínica do Dr. Henrique Mafra.

Clínica WF
Rua 981 nº196
Centro
Balneário Camboriú

Atendimento via WhatsApp.

Nunca falar valores.

Data mínima para agendamento:
${nextDateText}

Horários disponíveis:

14h
15h
16h
17h
18h
19h30

Funcionamento:

Terça a Sexta
14h às 20h

Sábado apenas exceção 10h.

Nunca inventar datas.
Nunca inventar horários.

Respostas naturais.
Curto.
WhatsApp real.

Finalizar:

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

    res.type("text/xml").send(`
<Response>
<Message>${reply}</Message>
</Response>
`);

  } catch (error) {

    console.log(error);

    res.type("text/xml").send(`
<Response>
<Message>No momento estamos finalizando atendimentos. Pode me enviar novamente sua mensagem? 😊</Message>
</Response>
`);
  }

});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("Servidor rodando");
});
