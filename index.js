import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.urlencoded({ extended: false }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/whatsapp", async (req, res) => {
  try {
    const mensagem = req.body.Body;

    const resposta = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Você é a assistente virtual da clínica estética do Dr. Henrique Mafra. Seja simpática, humanizada e profissional.",
        },
        { role: "user", content: mensagem },
      ],
    });

    res.set("Content-Type", "text/xml");
    res.send(`
      <Response>
        <Message>${resposta.choices[0].message.content}</Message>
      </Response>
    `);
  } catch (error) {
    console.error(error);
    res.send("<Response><Message>Erro interno.</Message></Response>");
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando...");
});
