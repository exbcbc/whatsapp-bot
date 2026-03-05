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

function detectName(msg){

const match =
msg.match(/meu nome é ([A-Za-zÀ-ú]+)/i) ||
msg.match(/me chamo ([A-Za-zÀ-ú]+)/i) ||
msg.match(/sou o ([A-Za-zÀ-ú]+)/i) ||
msg.match(/sou a ([A-Za-zÀ-ú]+)/i);

if(match) return match[1];

return null;

}

function detectProcedure(msg){

const t=msg.toLowerCase();

if(t.includes("botox") || t.includes("ruga"))
return "botox";

if(t.includes("preenchimento") || t.includes("lábio") || t.includes("labio"))
return "preenchimento";

if(t.includes("papada"))
return "lipo de papada";

if(t.includes("vaso"))
return "microvasos";

if(t.includes("melasma") || t.includes("mancha"))
return "tratamento de manchas";

if(t.includes("flacidez"))
return "bioestimulador";

return null;

}

function classifyLead(msg){

const t=msg.toLowerCase();

if(
t.includes("agendar") ||
t.includes("marcar") ||
t.includes("horário")
) return "quente";

if(
t.includes("valor") ||
t.includes("preço") ||
t.includes("quanto custa")
) return "frio";

return "morno";

}

async function salvarLead(nome,telefone,procedimento,lead){

try{

await axios.post(SHEET_API,{
data:[{
data:new Date().toLocaleDateString("pt-BR"),
nome:nome || "",
telefone:telefone,
procedimento:procedimento || "",
lead:lead || "",
status:"lead"
}]
});

}catch(e){

console.log("Erro salvar lead");

}

}

function scheduleFollowUps(user,phone){

const nextDateText=formatDate(nextAvailableDate());
const interactionTime=user.lastInteraction;

setTimeout(()=>{

if(!conversations[phone]) return;

if(conversations[phone].lastInteraction !== interactionTime) return;

sendWhatsAppMessage(phone,
`Vi que você estava vendo sobre o procedimento.

O próximo horário disponível é ${nextDateText} às 19h30.

Posso reservar esse horário para você?`
);

},10*60*1000);

setTimeout(()=>{

if(!conversations[phone]) return;

if(conversations[phone].lastInteraction !== interactionTime) return;

sendWhatsAppMessage(phone,
`A agenda do Dr Henrique Mafra costuma ficar concorrida.

Ainda tenho disponível ${nextDateText} às 19h30.

Posso garantir esse horário para você?`
);

},60*60*1000);

setTimeout(()=>{

if(!conversations[phone]) return;

if(conversations[phone].lastInteraction !== interactionTime) return;

sendWhatsAppMessage(phone,
`Alguns horários desta semana já foram preenchidos.

Se quiser, posso garantir ${nextDateText} às 19h30 para sua avaliação.`
);

},3*60*60*1000);

}

async function aiReply(history,nextDateText){

const completion=await openai.chat.completions.create({

model:"gpt-4o-mini",

messages:[

{
role:"system",
content:`

Você é a assistente da clínica do Dr Henrique Mafra.

Objetivo: converter o paciente para consulta.

Sempre oferecer primeiro o próximo dia disponível às 19h30.

Formato:

"O próximo dia disponível é ${nextDateText} às 19h30. Posso reservar esse horário para você?"

Se perguntarem valores:

Explique que cada caso precisa de avaliação.

"A consulta de avaliação tem valor de R$150. Caso realize o procedimento esse valor é abatido."

Se o paciente disser que não pode no horário, tente oferecer outra data.

Sempre conduza para agendamento.

Nunca usar emojis.

Respostas curtas.

`
},

...history

]

});

return completion.choices[0].message.content;

}

async function sendWhatsAppMessage(to,text){

const url=`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;

await axios.post(url,new URLSearchParams({
From:"whatsapp:+14155238886",
To:to,
Body:text
}),{
auth:{
username:process.env.TWILIO_ACCOUNT_SID,
password:process.env.TWILIO_AUTH_TOKEN
}
});

}

app.post("/whatsapp", async(req,res)=>{

try{

const from=req.body.From;
let message=req.body.Body || "";

if(!conversations[from]){

conversations[from]={
history:[],
nome:null,
procedimento:null,
lead:null,
iaAtiva:true,
lastInteraction:Date.now()
};

}

const user=conversations[from];

user.lastInteraction=Date.now();

const name=detectName(message);
if(name) user.nome=name;

const procedure=detectProcedure(message);
if(procedure) user.procedimento=procedure;

user.lead=classifyLead(message);

await salvarLead(user.nome,from,user.procedimento,user.lead);

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
