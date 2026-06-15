const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;
const WHATSAPP_TOKEN  = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN    = process.env.VERIFY_TOKEN;

// ─── ESTADO POR USUARIO ──────────────────────────────────────
// etapa: 'inicio' | 'cotizar' | 'agendar'
const usuarios = {};

// ─── SISTEMA DE GALIA ────────────────────────────────────────
const SYSTEM_COTIZAR = `Eres "Galia", asesora capilar experta de Galiebra Beauty (salón premium en México).

Tu misión: recopilar toda la información necesaria para dar una cotización personalizada y profesional.

FLUJO DE COTIZACIÓN — sigue este orden estrictamente:
1. Pide una foto reciente del cabello (parte trasera, luz indirecta) para ver largo, volumen y color.
2. Pregunta: ¿Cuándo fue la última vez que teñiste tu cabello?
3. Pregunta: ¿Qué color usaste?
4. Pregunta: ¿Te has realizado algún tratamiento capilar como keratina o alisado? ¿Hace cuánto?
5. Pregunta: ¿Qué te gustaría lograr? (puedes pedir foto de referencia)
6. Con toda esa información, da la cotización.

PRECIOS:
- Efecto de Color: varía según largo del cabello y procesos previos (da rango o pide foto primero)
- Corte: $300 MXN fijo
- Botox Capilar o Glossing Hair: $1,500 MXN
- Matiz: $1,600 MXN

IMPORTANTE:
- Sé cálida, empática y profesional.
- Menciona que cada cotización es única y personalizada.
- Si un proceso no es posible por el estado del cabello, sé transparente.
- En algunos casos puede ser necesaria una prueba de mechón.
- Respuestas cortas y escaneables para WhatsApp.
- Siempre en español latinoamericano.`;

const SYSTEM_AGENDAR = `Eres "Galia", asesora capilar experta de Galiebra Beauty (salón premium en México).

Tu misión: ayudar a la clienta a agendar su cita de forma clara y profesional.

SERVICIOS DISPONIBLES:
1. Efecto de Color
2. Corte — $300 MXN — Anticipo: $200 MXN
3. Botox Capilar o Glossing Hair — $1,500 MXN — Anticipo: $500 MXN
4. Matiz — $1,600 MXN — Anticipo: $500 MXN

FLUJO DE AGENDAMIENTO:
1. Pregunta qué servicio desea.
2. Confirma el precio del servicio.
3. Explica que se requiere anticipo para apartar la cita.
4. Da los datos bancarios:
   - Beneficiario: Galiebra Beauty
   - CLABE: 722969010127115452
   - Banco: STP (Sistema de Transferencias y Pagos)
5. Pide que envíe el comprobante para confirmar horario disponible.
6. Explica que recibirá un correo con fecha, horario, dirección y opción de agregar a su agenda.

POLÍTICAS:
- Solo se atiende con cita previa.
- No hay reembolsos una vez generado el anticipo.
- Reagendamiento con mínimo 48 horas de anticipación.
- Tolerancia de 15 minutos; pasado ese tiempo se cancela la cita.
- Tiempo de tolerancia: 15 minutos.

IMPORTANTE:
- Sé cálida y profesional.
- Respuestas cortas para WhatsApp.
- Siempre en español latinoamericano.`;

// ─── ENVIAR MENSAJE DE TEXTO ─────────────────────────────────
async function enviarMensaje(to, texto) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: texto }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// ─── ENVIAR BOTONES ──────────────────────────────────────────
async function enviarBotones(to) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: "¿En qué podemos ayudarte hoy? 💚"
        },
        action: {
          buttons: [
            { type: "reply", reply: { id: "cotizar", title: "💰 Cotizar" } },
            { type: "reply", reply: { id: "agendar", title: "📅 Agendar cita" } }
          ]
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// ─── LLAMAR A GEMINI ─────────────────────────────────────────
async function llamarGemini(systemPrompt, historial) {
  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: historial,
      generationConfig: { temperature: 0.85, maxOutputTokens: 600 }
    }
  );
  return res.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ─── WEBHOOK VERIFICACIÓN ────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── WEBHOOK MENSAJES ────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const body    = req.body;
    if (body.object !== "whatsapp_business_account") return;

    const entry   = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;
    const message = value?.messages?.[0];
    if (!message) return;

    const from = message.from;

    // ─── INICIALIZAR USUARIO ────────────────────────────────
    if (!usuarios[from]) {
      usuarios[from] = { etapa: "inicio", historial: [] };
    }

    const user = usuarios[from];

    // ─── MENSAJE DE BIENVENIDA (primer contacto o "hola") ───
    const esTexto    = message.type === "text";
    const esBoton    = message.type === "interactive";
    const textoMsg   = esTexto ? message.text.body.toLowerCase().trim() : "";
    const botonId    = esBoton ? message.interactive?.button_reply?.id : null;

    const saludos = ["hola", "hi", "hello", "buenos días", "buen día", "buenas", "buenas tardes", "buenas noches", "hey", "inicio", "empezar"];
    const esSaludo = saludos.some(s => textoMsg.includes(s));

    if (user.etapa === "inicio" || esSaludo) {
      await enviarMensaje(from,
        "¡Hola! 💖 Bienvenida a *Galiebra Beauty*.\n\nSoy *Galia*, tu asesora capilar personal. Estamos encantadas de atenderte. ✨\n\nEn Galiebra Beauty cuidamos tu cabello con profesionalismo, responsabilidad y mucho amor. 💚\n\n¡Tu salud capilar es nuestra prioridad!"
      );
      await new Promise(r => setTimeout(r, 800));
      await enviarBotones(from);
      user.etapa = "menu";
      user.historial = [];
      return;
    }

    // ─── SELECCIÓN DE BOTÓN ─────────────────────────────────
    if (botonId === "cotizar") {
      user.etapa = "cotizar";
      user.historial = [];
      await enviarMensaje(from,
        "¡Con gusto te cotizamos! 💇‍♀️✨\n\nPara darte un presupuesto personalizado, necesito conocer tu cabello.\n\n📸 Para empezar, *¿puedes enviarnos una foto reciente de tu cabello?* (parte trasera, con luz indirecta)\n\nEsto nos ayuda a ver el largo, volumen y color actual. 💚"
      );
      return;
    }

    if (botonId === "agendar") {
      user.etapa = "agendar";
      user.historial = [];
      await enviarMensaje(from,
        "¡Perfecto, con gusto te agendamos! 📅💚\n\nNuestros servicios disponibles son:\n\n✂️ *Corte* — $300 MXN\n🎨 *Efecto de Color* — precio personalizado\n💆 *Botox Capilar / Glossing Hair* — $1,500 MXN\n✨ *Matiz* — $1,600 MXN\n\n¿Qué servicio te interesa?"
      );
      return;
    }

    // ─── FLUJO DE COTIZACIÓN O AGENDAMIENTO CON IA ──────────
    if (user.etapa === "cotizar" || user.etapa === "agendar") {
      const systemPrompt = user.etapa === "cotizar" ? SYSTEM_COTIZAR : SYSTEM_AGENDAR;

      // Agregar mensaje al historial
      if (esTexto) {
        user.historial.push({ role: "user", parts: [{ text: message.text.body }] });
      } else if (message.type === "image") {
        user.historial.push({ role: "user", parts: [{ text: "[La clienta envió una foto de su cabello]" }] });
      }

      // Limitar historial
      if (user.historial.length > 20) {
        user.historial = user.historial.slice(-20);
      }

      const respuesta = await llamarGemini(systemPrompt, user.historial);
      user.historial.push({ role: "model", parts: [{ text: respuesta }] });

      await enviarMensaje(from, respuesta);
      console.log(`✅ Respuesta enviada a ${from}`);
      return;
    }

    // ─── CUALQUIER OTRO MENSAJE → MOSTRAR MENÚ ──────────────
    await enviarBotones(from);
    user.etapa = "menu";

  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
  }
});

// ─── SALUD ───────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("🌿 Galia — Galiebra Beauty Chatbot activo ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor Galia corriendo en puerto ${PORT}`);
});
