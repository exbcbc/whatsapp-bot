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

const DOMAIN = "https://whatsapp-bot-production-5f72.up.railway.app";
const SHEET_API = "https://sheetdb.io/api/v1/wgkxf59rp8phz";

const CLINIC_PHONE = "whatsapp:+554731700136";
const ADMIN_PHONE = "whatsapp:+5547991812557";

const conversations = {};

function getBrazilDate(){
return new Date(new Date().toLocaleString("en-US",{timeZone:"America/Sao_Paulo"}));
}

function nextAvailableDate(){

let d=getBrazilDate();

d.setDate(d.getDate()+5);

while(d.getDay()===0 || d.getDay()===1 || d.getDay()===6){
d.setDate(d.getDate()+1);
}

return d;
}

function formatDate(date){
return date.toLocaleDateString("pt-BR",{
weekday:"long",
day:"numeric",
month:"long",
year:"numeric",
timeZone:"America/Sao_Paulo"
});
}

function detectProcedure(msg){

const t=msg.toLowerCase();

if(t.includes("botox")) return "botox";
if(t.includes("preenchimento")) return "preenchimento";
if(t.includes("papada")) return "lipo de papada";
if(t.includes("vaso")) return "microvasos";
if(t.includes("melasma")) return "melasma";
if(t.includes("flacidez")) return "bioestimulador";

return "";

}

async function sendWhatsAppMessage(to,text){

const url=`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;

await axios.post(url,new URLSearchParams({
From:CLINIC_PHONE,
To:to,
Body:text
}),{
auth:{
username:process.env.TWILIO_ACCOUNT_SID,
password:process.env.TWILIO_AUTH_TOKEN
}
});

}

async function notifyAdmin(phone,message,procedure){

if(phone===ADMIN_PHONE) return;

await sendWhatsAppMessage(
ADMIN_PHONE,
`Paciente: ${phone}

Procedimento: ${procedure || "não identificado"}

Mensagem:
${message}`
);

}

function scheduleFollowUps(user,phone){

const nextDateText=formatDate(nextAvailableDate());
const interactionTime=user.lastInteraction;

setTimeout(()=>{

if(!conversations[phone]) return;
if(conversations[phone].lastInteraction!==interactionTime) return;

sendWhatsAppMessage(phone,
`Vi que você estava vendo sobre procedimentos estéticos.

Ainda tenho avaliação disponível ${nextDateText} às 19h30.

Posso reservar esse horário para você?`
);

},10*60*1000);

}

async function aiReply(history,nextDateText){

const completion=await openai.chat.completions.create({

model:"gpt-4o-mini",

messages:[

{
role:"system",
content:`

Você é a assistente da clínica do Dr Henrique Mafra.

Atenda de forma profissional e natural.

Fluxo da conversa:

1 Cumprimente o paciente.

2 Pergunte qual procedimento ele deseja avaliar.

Exemplo:
"Qual procedimento você gostaria de avaliar?"

3 Explique que é necessário uma avaliação.

4 Ofereça agendamento.

Formato:

"O próximo dia disponível é ${nextDateText} às 19h30. Posso reservar esse horário para você?"

Se perguntarem valores:

"A consulta de avaliação tem valor de R$150 e caso realize o procedimento esse valor é abatido."

Nunca usar emojis.

Respostas curtas.

`
},

...history

]

});

return completion.choices[0].message.content;

}

app.post("/whatsapp", async(req,res)=>{

try{

const from=req.body.From;
let message=req.body.Body || "";

if(from===ADMIN_PHONE){

if(message.startsWith("@")){

const parts=message.split("\n");

const phone="whatsapp:+"+parts[0].replace("@","").trim();

const text=parts.slice(1).join("\n");

await sendWhatsAppMessage(phone,text);

if(conversations[phone]){
conversations[phone].iaAtiva=false;
}

return res.sendStatus(200);

}

}

if(!conversations[from]){

conversations[from]={
history:[],
procedimento:"",
iaAtiva:true,
lastInteraction:Date.now()
};

}

const user=conversations[from];

user.lastInteraction=Date.now();

const procedure=detectProcedure(message);
if(procedure) user.procedimento=procedure;

await notifyAdmin(from,message,user.procedimento);

if(!user.iaAtiva) return res.sendStatus(200);

user.history.push({role:"user",content:message});

const nextDateText=formatDate(nextAvailableDate());

const reply=await aiReply(user.history,nextDateText);

user.history.push({role:"assistant",content:reply});

scheduleFollowUps(user,from);

res.type("text/xml").send(`<Response><Message>${reply}</Message></Response>`);

}catch(err){

console.log(err);

res.type("text/xml").send(`<Response><Message>Ocorreu uma instabilidade. Pode enviar novamente?</Message></Response>`);

}

});

const PORT=process.env.PORT || 8080;

app.listen(PORT,()=>{
console.log("Servidor rodando");
});
