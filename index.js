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

// =========================
// MEMÓRIA POR NÚMERO
// =========================
const conversations = {};

// =========================
// DATA INTELIGENTE (+5 DIAS)
// =========================
function getNextBusinessDay() {
  let date = new Date();
  date.setDate(date.getDate() + 5);

  while (date.getDay() === 0 || date.getDay() === 1 || date.getDay() === 6) {
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

app.post("/whatsapp", async (req, res) => {
  try {
    const incomingMessage = req.body.Body;
    const from = req.body.From;

    if (!conversations[from]) {
      conversations[from] = [];
    }

    conversations[from].push({
      role: "user",
      content: incomingMessage,
    });

    const nextAvailableDateObj = getNextBusinessDay();
    const nextAvailableDate = formatDate(nextAvailableDateObj);

    let strategicInstruction = `
Data mínima para agendamento: ${nextAvailableDate}.
Priorizar horário das 19h30.
Nunca oferecer sábado ou domingo como padrão.
`;

    const lowerMessage = incomingMessage.toLowerCase();

    if (
      lowerMessage.includes("não posso") ||
      lowerMessage.includes("nao posso") ||
      lowerMessage.includes("outro horário") ||
      lowerMessage.includes("outro horario")
    ) {
      strategicInstruction = `
Paciente recusou horário.

1ª alternativa: oferecer horário entre 14h e 18h no mesmo dia.
Se ainda recusar:
2ª alternativa: abrir exceção sábado às 10h.
Se recusar sábado:
3ª alternativa: oferecer outro dia útil entre 14h e 18h.
`;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Você é a assistente oficial do Dr. Henrique Mafra.

ATENDIMENTO VIA WHATSAPP.
Respostas curtas.
Naturais.
Conversacionais.
Nunca parecer e-mail formal.
Nunca usar "Atenciosamente".

IDENTIDADE:
Especialista em Biomedicina Estética.
Autor do livro "Toxina Botulínica Descomplicada".
Criador dos protocolos Beleza Renovada, Neuro Block, HiFu Master Lift e ReduXpress.

LOCAL:
Clínica WF
Rua 981, nº 196 – Centro
Balneário Camboriú – SC

PROCEDIMENTOS:
Toxina Botulínica
Preenchimento
Bioestimulador de colágeno
HIFU
Fios de PDO
Lipo de papada sem corte
PEIM (vasinhos)
Remoção de verrugas
Blefaroplastia sem corte
Redução de medidas
Terapia ortomolecular
Tratamento de melasma
Tratamento de hiperidrose
Rinomodelação
Lobuloplastia
Pescoço de boneca
Harmonização das mãos

REGRAS:
- Sempre responder a pergunta primeiro.
- Depois conduzir para agendamento.
- Nunca falar valores.
- Dizer que valores são definidos após avaliação personalizada.
- Criar leve escassez.
- Priorizar 19h30.

${strategicInstruction}

Finalizar incentivando confirmação.
Assinar apenas:
Equipe Dr. Henrique Mafra
`,
        },
        ...conversations[from],
      ],
    });

    const reply = completion.choices[0].message.content;

    conversations[from].push({
      role: "assistant",
      content: reply,
    });

    res.set("Content-Type", "text/xml");
    res.send(`
      <Response>
        <Message>${reply}</Message>
      </Response>
    `);
  } catch (error) {
    console.error(error);
    res.set("Content-Type", "text/xml");
    res.send(`
      <Response>
        <Message>No momento estamos finalizando atendimentos. Pode nos enviar sua mensagem novamente?</Message>
      </Response>
    `);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});
