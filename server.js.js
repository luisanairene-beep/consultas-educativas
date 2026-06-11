const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'https://paeoeclnlrjkfnyxwqna.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'tu_clave_anon_o_service_role_aqui';
const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: 'public' },
  auth: { persistSession: false },
  realtime: { transport: ws }
});

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey_change_in_production';

// Registro de usuario
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const { data, error } = await supabase
      .from('users')
      .insert([{ username, email, password: hashedPassword }])
      .select();

    if (error) {
      if (error.code === '23505') { // Unique violation
        return res.status(400).json({ error: 'El usuario o correo ya existe' });
      }
      return res.status(400).json({ error: error.message });
    }
    
    res.json({ message: 'Usuario registrado exitosamente' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Inicio de sesión
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !users) {
      return res.status(400).json({ error: 'Credenciales inválidas' });
    }

    const valid = await bcrypt.compare(password, users.password);
    if (!valid) {
      return res.status(400).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign({ id: users.id, username: users.username }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, username: users.username });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Función de generación de respuesta IA
async function generateAIResponse(question) {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: `Actúa como un tutor experto y paciente. Explica de manera clara, didáctica y estructurada la siguiente pregunta de estudio: ${question}` }]
      })
    });
    const data = await response.json();
    if (data.choices && data.choices[0]) {
      return data.choices[0].message.content;
    }
    return "Lo siento, no pude generar una respuesta en este momento.";
  } catch (error) {
    console.error("Error al llamar a la API de IA:", error);
    return "Ocurrió un error al procesar tu pregunta. Por favor, inténtalo de nuevo.";
  }
}

// Hacer una pregunta
app.post('/api/questions', async (req, res) => {
  const { question } = req.body;
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const aiAnswer = await generateAIResponse(question);
    
    const { data, error } = await supabase
      .from('questions')
      .insert([{ user_id: decoded.id, question, answer: aiAnswer }])
      .select();

    if (error) {
      return res.status(500).json({ error: 'Error de base de datos' });
    }
    
    res.json({ id: data[0].id, question, answer: aiAnswer });
  } catch (e) {
    console.error(e);
    res.status(401).json({ error: 'Token inválido' });
  }
});

// Obtener historial de preguntas
app.get('/api/questions', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('user_id', decoded.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Error de base de datos' });
    }
    
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(401).json({ error: 'Token inválido' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});