import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const DOMAIN = "https://whatsapp-bot-production-5f72.up.railway.app";

/* CHATWOOT CONFIG */

const CHATWOOT_URL = "https://drhm.up.railway.app";
const CHATWOOT_ACCOUNT_ID = "2";
const CHATWOOT_TOKEN = "K4iNRKnchfhA2TcmQC1tzzb";
const CHATWOOT_INBOX_ID = "1";

/* CONTROLE DE CONVERSA */

const conversations = {};
const processing = {};

/* ENVIAR MENSAGEM PARA CHATWOOT */

async function sendToChatwoot(phone, message) {
  try {

    const contact = await axios.post(
      `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts`,
      {
        name: phone,
        phone_number: phone
      },
      {
        headers: {
          api_access_token: CHATWOOT_TOKEN
        }
      }
    );

    const contactId = contact.data.payload.contact.id;

    const conversation = await axios.post(
      `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations`,
      {
        source_id: phone,
        inbox_id: CHATWOOT_INBOX_ID,
        contact_id: contactId
      },
      {
        headers: {
          api_access_token: CHATWOOT_TOKEN
        }
      }
    );

    const conversationId = conversation.data.id;

    await axios.post(
      `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
      {
        content: message,
        message_type: "incoming"
      },
      {
        headers: {
          api_access_token: CHATWOOT_TOKEN
        }
      }
    );

  } catch (e) {
    console.log("erro chatwoot");
  }
}

/* ENVIAR WHATSAPP */

async function sendWhatsAppMessage(to, text) {

  const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;

  await axios.post(
    url,
    new URLSearchParams({
      From: "whatsapp:+14155238886",
      To: to,
      Body: text
    }),
    {
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN
      }
    }
  );

}

/* IA */

async function aiReply(history) {

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
Você é a assistente da clínica Dr Henrique Mafra.

Regras:

respostas curtas
educada
profissional
não fale valores
sempre incentive avaliação presencial
`
      },
      ...history
    ]
  });

  return completion.choices[0].message.content;

}

/* WEBHOOK WHATSAPP */

app.post("/whatsapp", async (req, res) => {

  try {

    const from = req.body.From;
    const message = req.body.Body || "";

    if (processing[from]) return res.sendStatus(200);
    processing[from] = true;

    if (!conversations[from]) {
      conversations[from] = {
        history: [],
        iaAtiva: true
      };
    }

    const user = conversations[from];

    /* COMANDOS */

    if (message === "#humano") {
      user.iaAtiva = false;
      processing[from] = false;
      return res.sendStatus(200);
    }

    if (message === "#ia") {
      user.iaAtiva = true;
      processing[from] = false;
      return res.sendStatus(200);
    }

    if (!user.iaAtiva) {
      processing[from] = false;
      return res.sendStatus(200);
    }

    user.history.push({
      role: "user",
      content: message
    });

    await sendToChatwoot(from, message);

    const reply = await aiReply(user.history);

    user.history.push({
      role: "assistant",
      content: reply
    });

    await sendWhatsAppMessage(from, reply);

    processing[from] = false;

    res.sendStatus(200);

  } catch (err) {

    console.log(err);
    res.sendStatus(200);

  }

});

/* SERVER */

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("BOT ONLINE");
});
