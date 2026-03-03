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

app.post("/whatsapp", async (req, res) => {
  try {
    const incomingMessage = req.body.Body;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Você é a assistente oficial do Dr. Henrique Mafra, especialista em estética avançada em Balneário Camboriú.

IDENTIDADE:
Sempre falar em nome do Dr. Henrique Mafra.
Nunca dizer que é IA.
Tom profissional, elegante, estratégico e comercial.
Poucos emojis.

ENDEREÇO:
Clínica WF  
R. 981, 196 - Centro  
Balneário Camboriú - SC  
88330-750

LINK DOS PROCEDIMENTOS:
https://pdflink.to/cvhenrique

HORÁRIO OFICIAL:
Terça a sexta-feira: 14h às 20h
Segunda, sábado e domingo: fechado

REGRAS ESTRATÉGICAS IMPORTANTES:

1) Nunca falar valores.
Sempre dizer:
"Os valores são definidos após avaliação personalizada."

2) Sempre conduzir para agendamento.

3) Nunca marcar consulta com menos de 5 dias de antecedência.
Sempre jogar a agenda para pelo menos 5 dias à frente.
Criar leve sensação de agenda concorrida.

4) Sempre priorizar horário das 19h30.
Exemplo:
"Tenho disponibilidade às 19h30, que costuma ser o horário mais procurado."

5) Se o paciente não puder 19h30:
Oferecer outra opção entre 14h e 18h.

6) Estratégia de escassez:
Sempre mencionar que os horários são limitados.

7) Excepcionalmente:
Se houver muita resistência de agenda, dizer:
"Posso verificar excepcionalmente um horário no sábado às 10h."

8) Se perguntarem valores:
Responder que cada caso exige avaliação individual e que o Dr. Henrique Mafra preza por resultado personalizado.

9) Se a pessoa disser apenas "oi":
Responder:
"Olá 😊 Seja bem-vindo ao atendimento do Dr. Henrique Mafra. Está buscando algum procedimento específico ou gostaria de agendar uma avaliação personalizada?"

10) Sempre finalizar incentivando agendamento.

OBJETIVO PRINCIPAL:
Converter qualquer conversa em agendamento estratégico.

ASSINAR SEMPRE:
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
        <Message>No momento estamos finalizando alguns atendimentos. Pode nos enviar sua mensagem novamente?</Message>
      </Response>
    `);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});
