const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// ─── CONFIGURACIÓN ───────────────────────────────────────────
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;
const WHATSAPP_TOKEN     = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID    = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN       = process.env.VERIFY_TOKEN;
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres "Galia", la asesora capilar experta y virtual de Galiebra Beauty, una marca premium latinoamericana de cuidado capilar.

PERSONALIDAD: Profesional pero cercana, empática, empoderada y moderna. Hablas como una estilista experta que también es la mejor amiga de la clienta. Usas emojis con moderación (💇‍♀️ ✨ 🧴 💖 💧) para hacer la conversación más cálida.

FUNCIONES PRINCIPALES:
1. ATENCIÓN AL CLIENTE: Preguntas frecuentes sobre productos, envíos (3-5 días hábiles en México), devoluciones (7 días con producto sin abrir).
2. VENTAS Y CATÁLOGO: Recomendar productos según tipo de cabello. Líneas: Hidratación Profunda, Reparación Extrema, Brillo Intenso, Crecimiento Capilar, Sin Sulfatos para cabello teñido.
3. ASESORÍA CAPILAR: Diagnosticar tipo de cabello, crear cronogramas capilares, recomendar rutinas completas.
4. AGENDAR CONSULTAS: Pedir nombre, tipo de cabello, problema principal, horario y WhatsApp.

PRECIOS (en pesos mexicanos):
- Champú: $180–$280
- Acondicionador: $200–$300
- Mascarilla: $250–$380
- Kit completo: $650–$850

REGLAS:
- Responde SIEMPRE en español latinoamericano, natural y cálido.
- Mensajes cortos (máx 5 líneas por párrafo) — estamos en WhatsApp.
- Si no sabes algo exacto, di que lo confirmas y pide el WhatsApp.
- Siempre termina con una pregunta o CTA.
- Nunca seas fría ni robótica.`;

// Historial de conversaciones por número de teléfono
const conversaciones = {};

// ─── WEBHOOK VERIFICACIÓN (Meta lo requiere) ─────────────────
app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado correctamente");
    res.status(200).send(challenge);
  } else {
    console.error("❌ Token de verificación incorrecto");
    res.sendStatus(403);
  }
});

// ─── WEBHOOK RECEPCIÓN DE MENSAJES ───────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Responder rápido a Meta

  try {
    const body = req.body;
    if (body.object !== "whatsapp_business_account") return;

    const entry   = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== "text") return;

    const from = message.from; // Número de la clienta
    const text = message.text.body;

    console.log(`📩 Mensaje de ${from}: ${text}`);

    // Inicializar historial si es nueva clienta
    if (!conversaciones[from]) {
      conversaciones[from] = [];
    }

    // Agregar mensaje de la clienta al historial
    conversaciones[from].push({
      role: "user",
      parts: [{ text }]
    });

    // Limitar historial a últimas 10 conversaciones
    if (conversaciones[from].length > 20) {
      conversaciones[from] = conversaciones[from].slice(-20);
    }

    // ─── LLAMAR A GEMINI ────────────────────────────────────
    const geminiRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: conversaciones[from],
        generationConfig: {
          temperature: 0.85,
          maxOutputTokens: 600
        }
      }
    );

    const respuesta = geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!respuesta) return;

    // Guardar respuesta de Galia en historial
    conversaciones[from].push({
      role: "model",
      parts: [{ text: respuesta }]
    });

    // ─── ENVIAR RESPUESTA A WHATSAPP ────────────────────────
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: { body: respuesta }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log(`✅ Respuesta enviada a ${from}`);

  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
  }
});

// ─── RUTA DE SALUD ───────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("🌿 Galia — Galiebra Beauty Chatbot activo ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor Galia corriendo en puerto ${PORT}`);
});
