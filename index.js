import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =============================
// MEMÓRIA
// =============================
const conversations = {};

// =============================
// DATA INTELIGENTE
// =============================
function getNextBusinessDay() {
  let date = new Date();
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

function formatDate(date) {
  return date.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// =============================
// EXTRAIR NOME
// =============================
function extractName(message) {
  const patterns = [
    /me chamo\s+([a-zA-ZÀ-ú]+)/i,
    /meu nome é\s+([a-zA-ZÀ-ú]+)/i,
    /sou a\s+([a-zA-ZÀ-ú]+)/i,
    /sou o\s+([a-zA-ZÀ-ú]+)/i,
  ];

  for (let pattern of patterns) {
    const match = message.match(pattern);
    if (match) return match[1];
  }

  return null;
}

// =============================
// DETECTAR OBJEÇÃO DE PREÇO
// =============================
function isPriceObjection(message) {
  const lower = message.toLowerCase();
  return (
    lower.includes("valor") ||
    lower.includes("preço") ||
    lower.includes("quanto custa") ||
    lower.includes("custa quanto") ||
    lower.includes("parcel") ||
    lower.includes("condição")
  );
}

// =============================
// DETECTAR CONFIRMAÇÃO
// =============================
function isConfirmation(message) {
  const lower = message.toLowerCase();
  return (
    lower.includes("confirmo") ||
    lower.includes("pode marcar") ||
    lower.includes("fechado") ||
    lower.includes("ok pode") ||
    lower.includes("pode agendar")
  );
}

// =============================
// ROTA WHATSAPP
// =============================
app.post("/whatsapp", async (req, res) => {
  try {
    const incomingMessage = req.body.Body;
    const from = req.body.From;

    if (!conversations[from]) {
      conversations[from] = {
        history: [],
        name: null,
        scheduledDate: null,
      };
    }

    const userData = conversations[from];

    // Salvar nome
    const detectedName = extractName(incomingMessage);
    if (detectedName) {
      userData.name = detectedName;
    }

    userData.history.push({
      role: "user",
      content: incomingMessage,
    });

    const nextDateObj = getNextBusinessDay();
    const nextDate = formatDate(nextDateObj);

    // Se for objeção de preço
    if (isPriceObjection(incomingMessage)) {
      const reply = `${userData.name ? userData.name + ", " : ""}entendo sua dúvida 😊

Como cada caso exige uma avaliação individual, os valores são definidos após analisarmos suas necessidades específicas.

O Dr. Henrique Mafra trabalha com protocolos personalizados para garantir segurança e resultado natural.

Posso verificar uma data para avaliarmos seu caso com calma?

Equipe Dr. Henrique Mafra`;

      return res.type("text/xml").send(`
        <Response>
          <Message>${reply}</Message>
        </Response>
      `);
    }

    // Se for confirmação de agendamento
    if (isConfirmation(incomingMessage)) {
      const finalDate = userData.scheduledDate || nextDate;

      const reply = `Perfeito${userData.name ? ", " + userData.name : ""} 😊

Seu horário ficou reservado para ${finalDate} às 19h30.

Qualquer imprevisto, pedimos que nos avise com antecedência.

Será um prazer te atender.

Equipe Dr. Henrique Mafra`;

      return res.type("text/xml").send(`
        <Response>
          <Message>${reply}</Message>
        </Response>
      `);
    }

    // GPT normal
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Você é a assistente oficial do Dr. Henrique Mafra.

Tom humano, natural e elegante.
Nunca robótico.
Nunca formal demais.
Nunca insistente.

Data mínima para agendamento:
${nextDate}

Identifique perfil:
Curioso → educar e conduzir.
Decidido → ir direto para agenda.
Indeciso → gerar segurança.

Nunca falar valores.
Sempre conduzir para avaliação.
Sugerir 19h30 apenas se paciente demonstrar interesse.

Assinar:
Equipe Dr. Henrique Mafra
`
        },
        ...userData.history,
      ],
    });

    const reply = completion.choices[0].message.content;

    userData.history.push({
      role: "assistant",
      content: reply,
    });

    res.type("text/xml").send(`
      <Response>
        <Message>${reply}</Message>
      </Response>
    `);
  } catch (error) {
    console.error(error);

    res.type("text/xml").send(`
      <Response>
        <Message>No momento estamos finalizando atendimentos. Pode me enviar novamente sua mensagem? 😊</Message>
      </Response>
    `);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});
