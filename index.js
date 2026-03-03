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

function getNextBusinessDay() {
  let date = new Date();
  date.setDate(date.getDate() + 5);

  while (date.getDay() === 0 || date.getDay() === 1 || date.getDay() === 6) {
    // 0 = domingo, 1 = segunda, 6 = sábado
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
    const incomingMessage = req.body.Body.toLowerCase();

    const nextAvailableDateObj = getNextBusinessDay();
    const nextAvailableDate = formatDate(nextAvailableDateObj);

    let strategicInstruction = `
Data mínima para agendamento: ${nextAvailableDate}.
Oferecer prioritariamente às 19h30.
`;

    if (
      incomingMessage.includes("não posso") ||
      incomingMessage.includes("nao posso") ||
      incomingMessage.includes("outro horário") ||
      incomingMessage.includes("outro horario")
    ) {
      strategicInstruction = `
Paciente demonstrou indisponibilidade.

1ª alternativa: oferecer horário entre 14h e 18h no mesmo dia.
Se ainda recusar:
2ª alternativa: abrir exceção sábado às 10h.
Se recusar sábado:
3ª alternativa: oferecer horário alternativo entre 14h e 18h em outro dia útil.
`;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Você é a assistente oficial do Dr. Henrique Mafra.

Sempre falar em nome do Dr. Henrique Mafra.
Nunca dizer que é IA.
Tom elegante, profissional e estratégico.

ENDEREÇO:
Clínica WF
R. 981, 196 - Centro
Balneário Camboriú - SC
88330-750

Link de procedimentos:
https://pdflink.to/cvhenrique

HORÁRIO OFICIAL:
Terça a sexta das 14h às 20h.
Nunca marcar segunda, sábado ou domingo como padrão.
Nunca agendar com menos de 5 dias.

REGRAS:
- Nunca falar valores.
- Sempre dizer que valores são definidos após avaliação personalizada.
- Sempre responder perguntas antes de conduzir.
- Sempre conduzir para agendamento.

${strategicInstruction}

Sempre gerar leve escassez de agenda.
Priorizar 19h30.
Finalizar incentivando confirmação.

Assinar:
Equipe Dr. Henrique Mafra
`,
        },
        {
          role: "user",
          content: incomingMessage,
        },
      ],
    });

    const reply = completion.choices[0].message.content;

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
