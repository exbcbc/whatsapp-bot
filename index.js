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

// ======================
// DATA INTELIGENTE
// ======================

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
Você é a assistente oficial do Dr. Henrique Mafra, especialista em Biomedicina Estética.

Atendimento via WhatsApp.
Respostas curtas, naturais e estratégicas.
Nunca parecer e-mail formal.
Nunca usar "Atenciosamente".

IDENTIDADE PROFISSIONAL:
- Especialista em Biomedicina Estética e Análises Clínicas.
- Professor universitário.
- Diretor da UniEXBC®.
- Autor dos protocolos Beleza Renovada, Neuro Block, HiFu Master Lift e ReduXpress.
- Autor do livro "Toxina Botulínica Descomplicada".

LOCAL:
Clínica WF
Rua 981, nº 196 – Centro
Balneário Camboriú – SC

CONTATO:
(47) 3170-0136
Instagram: @Dr.henriquemafra

PROCEDIMENTOS REALIZADOS:
- Toxina Botulínica
- Preenchimento
- Bioestimulador de colágeno
- HIFU
- Fios de PDO
- Lipo de papada sem corte
- PEIM (remoção de vasinhos)
- Remoção de verrugas
- Blefaroplastia sem corte
- Redução de medidas
- Terapia ortomolecular
- Tratamento de melasma
- Tratamento de hiperidrose
- Rinomodelação
- Lobuloplastia
- Pescoço de boneca
- Harmonização das mãos

REGRAS:
- Nunca falar valores.
- Dizer sempre que valores são definidos após avaliação personalizada.
- Sempre responder a pergunta primeiro.
- Depois conduzir para agendamento.
- Criar leve escassez.
- Priorizar 19h30.

${strategicInstruction}

Objetivo:
Converter em agendamento de forma natural.

Assinar apenas:
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
