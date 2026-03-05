import express from "express"
import dotenv from "dotenv"
import axios from "axios"
import fs from "fs"
import OpenAI from "openai"

dotenv.config()

const app=express()

app.use(express.urlencoded({extended:true}))
app.use(express.json())

const openai=new OpenAI({
apiKey:process.env.OPENAI_API_KEY
})

const CLINIC_PHONE="whatsapp:+SEU_NUMERO_TWILIO"

const conversations={}

/* DATA */

function getBrazilDate(){
return new Date(new Date().toLocaleString("en-US",{timeZone:"America/Sao_Paulo"}))
}

function nextAvailableDate(){

let d=getBrazilDate()

d.setDate(d.getDate()+5)

while(d.getDay()===0 || d.getDay()===1 || d.getDay()===6){
d.setDate(d.getDate()+1)
}

return d
}

function formatDate(date){

return date.toLocaleDateString("pt-BR",{
weekday:"long",
day:"numeric",
month:"long"
})

}

/* BAIXAR AUDIO */

async function downloadAudio(url){

const response=await axios({
url,
method:"GET",
responseType:"stream",
auth:{
username:process.env.TWILIO_ACCOUNT_SID,
password:process.env.TWILIO_AUTH_TOKEN
}
})

const path="./audio.ogg"

const writer=fs.createWriteStream(path)

response.data.pipe(writer)

return new Promise(resolve=>{
writer.on("finish",()=>resolve(path))
})

}

/* TRANSCRIÇÃO */

async function transcribe(path){

const transcription=await openai.audio.transcriptions.create({
file:fs.createReadStream(path),
model:"gpt-4o-transcribe"
})

return transcription.text
}

/* GERAR VOZ */

async function generateVoice(text){

const speech=await openai.audio.speech.create({
model:"gpt-4o-mini-tts",
voice:"nova",
input:text
})

const buffer=Buffer.from(await speech.arrayBuffer())

fs.writeFileSync("./reply.mp3",buffer)

}

/* IA */

async function aiReply(history,nextDateText){

const completion=await openai.chat.completions.create({

model:"gpt-4o-mini",

messages:[
{
role:"system",
content:`

Você é a assistente da clínica estética do Dr Henrique Mafra.

Seu objetivo é:

1 cumprimentar o paciente
2 perguntar qual procedimento deseja avaliar
3 explicar que é necessária avaliação
4 oferecer horário

exemplo:

"O próximo horário disponível é ${nextDateText} às 19h30. Posso reservar para você?"

Valor da avaliação:

"A consulta custa R$150 e é abatida se realizar o procedimento."

Respostas curtas.

Nunca usar emojis.

`
},
...history
]

})

return completion.choices[0].message.content
}

/* TWILIO */

app.post("/whatsapp",async(req,res)=>{

try{

const from=req.body.From
let message=req.body.Body || ""

const hasAudio=req.body.NumMedia && req.body.NumMedia>0

if(hasAudio){

const audioUrl=req.body.MediaUrl0

const path=await downloadAudio(audioUrl)

message=await transcribe(path)

}

/* MEMORIA */

if(!conversations[from]){

conversations[from]={
history:[]
}

}

const user=conversations[from]

user.history.push({
role:"user",
content:message
})

const nextDateText=formatDate(nextAvailableDate())

const reply=await aiReply(user.history,nextDateText)

user.history.push({
role:"assistant",
content:reply
})

/* AUDIO */

if(hasAudio){

await generateVoice(reply)

return res.type("text/xml").send(`
<Response>
<Message>
<Media>${process.env.DOMAIN}/reply.mp3</Media>
</Message>
</Response>
`)

}

/* TEXTO */

res.type("text/xml").send(`
<Response>
<Message>${reply}</Message>
</Response>
`)

}catch(err){

console.log(err)

res.type("text/xml").send(`
<Response>
<Message>Erro no servidor</Message>
</Response>
`)

}

})

app.listen(8080,()=>{
console.log("BOT rodando")
})
