const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { PDFDocument } = require('pdf-lib');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Determine DeepL API endpoint based on key type
// Free API keys end with ":fx", Pro keys don't
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const isFreePlan = DEEPL_API_KEY && DEEPL_API_KEY.endsWith(':fx');
const DEEPL_BASE_URL = isFreePlan 
  ? 'https://api-free.deepl.com/v2' 
  : 'https://api.deepl.com/v2';

// Check environment variables
console.log('Environment check:');
console.log('- PORT:', PORT);
console.log('- DEEPL_API_KEY:', DEEPL_API_KEY ? '✓ Set (length: ' + DEEPL_API_KEY.length + ')' : '✗ Not set');
console.log('- API Plan:', isFreePlan ? 'Free' : 'Pro');
console.log('- API Endpoint:', DEEPL_BASE_URL);
console.log('- NODE_ENV:', process.env.NODE_ENV || 'development');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('PDFファイルのみアップロード可能です'));
    }
  }
});

// Logging function
async function logTranslation(ip, sourceLanguage, targetLanguage, pageCount, characterCount, fileName) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    ip,
    sourceLanguage,
    targetLanguage,
    pageCount,
    characterCount,
    fileName
  };

  try {
    const logDir = path.join(__dirname, 'logs');
    await fs.mkdir(logDir, { recursive: true });

    const logFile = path.join(logDir, `translations_${new Date().toISOString().split('T')[0]}.json`);

    let logs = [];
    try {
      const data = await fs.readFile(logFile, 'utf8');
      logs = JSON.parse(data);
    } catch (err) {
      // File doesn't exist yet, start with empty array
    }

    logs.push(logEntry);
    await fs.writeFile(logFile, JSON.stringify(logs, null, 2));

    console.log(`Translation logged: ${fileName} (${pageCount} pages, ${characterCount} chars) - IP: ${ip}`);
  } catch (error) {
    console.error('Error logging translation:', error);
  }
}

// Get client IP address
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] ||
         req.connection.remoteAddress ||
         req.socket.remoteAddress;
}

// DeepL API translation function
async function translateText(text, targetLang, sourceLang = null) {
  try {
    console.log('Starting translation. Text length:', text.length, 'Target:', targetLang);
    
    // DeepL API has a limit of 50,000 characters per request
    const MAX_CHARS = 45000; // Use 45k to be safe
    
    if (text.length > MAX_CHARS) {
      console.log('Text too long, splitting into chunks');
      // Split text into chunks
      const chunks = [];
      for (let i = 0; i < text.length; i += MAX_CHARS) {
        chunks.push(text.substring(i, i + MAX_CHARS));
      }
      
      // Translate each chunk
      const translatedChunks = [];
      let detectedLang = null;
      
      for (let i = 0; i < chunks.length; i++) {
        console.log(`Translating chunk ${i + 1}/${chunks.length}`);
        const result = await translateChunk(chunks[i], targetLang, sourceLang);
        translatedChunks.push(result.translatedText);
        if (!detectedLang) detectedLang = result.detectedSourceLang;
      }
      
      return {
        translatedText: translatedChunks.join(''),
        detectedSourceLang: detectedLang
      };
    } else {
      return await translateChunk(text, targetLang, sourceLang);
    }
  } catch (error) {
    console.error('Translation error:', error);
    throw error;
  }
}

// Translate a single chunk
async function translateChunk(text, targetLang, sourceLang = null) {
  try {
    const params = new URLSearchParams();
    params.append('auth_key', DEEPL_API_KEY);
    params.append('text', text);
    params.append('target_lang', targetLang);
    if (sourceLang) {
      params.append('source_lang', sourceLang);
    }

    const response = await axios.post(`${DEEPL_BASE_URL}/translate`, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 60000, // 60 second timeout
      maxContentLength: 100 * 1024 * 1024, // 100MB
      maxBodyLength: 100 * 1024 * 1024
    });

    console.log('Translation successful. Response length:', response.data.translations[0].text.length);

    return {
      translatedText: response.data.translations[0].text,
      detectedSourceLang: response.data.translations[0].detected_source_language
    };
  } catch (error) {
    console.error('DeepL API Error:', error.response?.data || error.message);
    console.error('Error code:', error.code);
    console.error('Error config:', error.config?.url);
    
    if (error.code === 'ECONNABORTED') {
      throw new Error('翻訳がタイムアウトしました。テキストが長すぎる可能性があります。');
    }
    
    throw new Error('翻訳に失敗しました: ' + (error.response?.data?.message || error.message));
  }
}

// Extract text from PDF
async function extractTextFromPDF(buffer) {
  try {
    console.log('Starting PDF parsing, buffer size:', buffer.length);
    
    // pdf-parse options to avoid canvas dependency issues
    const options = {
      max: 0, // parse all pages
      version: 'v2.0.550' // use specific version
    };
    
    const data = await pdfParse(buffer, options);
    console.log('PDF parsed successfully. Pages:', data.numpages, 'Text length:', data.text.length);
    console.log('First 200 chars:', data.text.substring(0, 200));
    
    return {
      text: data.text,
      pageCount: data.numpages,
      info: data.info
    };
  } catch (error) {
    console.error('PDF parsing error:', error);
    console.error('Error stack:', error.stack);
    throw new Error('PDFの読み込みに失敗しました: ' + error.message);
  }
}

// Create translated PDF
async function createTranslatedPDF(originalBuffer, translatedText) {
  try {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();

    // Split text into lines that fit the page width
    const fontSize = 12;
    const maxWidth = width - 100;
    const lineHeight = fontSize * 1.2;

    const words = translatedText.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      if (testLine.length * fontSize * 0.5 < maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);

    // Draw text on pages
    let currentPage = page;
    let y = height - 50;

    for (const line of lines) {
      if (y < 50) {
        currentPage = pdfDoc.addPage();
        y = currentPage.getSize().height - 50;
      }

      currentPage.drawText(line, {
        x: 50,
        y: y,
        size: fontSize
      });

      y -= lineHeight;
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error('PDF creation error:', error);
    throw new Error('翻訳済みPDFの作成に失敗しました');
  }
}

// API endpoint: Translate PDF
app.post('/api/translate', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'ファイルがアップロードされていません' });
    }

    const { targetLang, sourceLang } = req.body;

    if (!targetLang) {
      return res.status(400).json({ error: '翻訳先言語が指定されていません' });
    }

    const clientIp = getClientIp(req);
    console.log(`Translation request from IP: ${clientIp}`);

    // Extract text from PDF
    const pdfData = await extractTextFromPDF(req.file.buffer);

    console.log('Extracted text length:', pdfData.text.length);
    console.log('Text content preview:', pdfData.text.substring(0, 100));

    if (!pdfData.text || pdfData.text.trim().length === 0) {
      console.error('Empty text extracted from PDF');
      return res.status(400).json({ 
        error: 'PDFからテキストを抽出できませんでした。このPDFは画像ベース（スキャン）の可能性があります。テキストレイヤーを持つPDFを使用してください。' 
      });
    }

    // Translate text
    const { translatedText, detectedSourceLang } = await translateText(
      pdfData.text,
      targetLang,
      sourceLang
    );

    // Create translated PDF
    const translatedPdfBuffer = await createTranslatedPDF(req.file.buffer, translatedText);

    // Log the translation
    await logTranslation(
      clientIp,
      detectedSourceLang || sourceLang || 'auto',
      targetLang,
      pdfData.pageCount,
      pdfData.text.length,
      req.file.originalname
    );

    // Send translated PDF
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="translated_${req.file.originalname}"`,
      'Content-Length': translatedPdfBuffer.length
    });

    res.send(translatedPdfBuffer);

  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({
      error: error.message || '翻訳処理中にエラーが発生しました'
    });
  }
});

// API endpoint: Get supported languages
app.get('/api/languages', async (req, res) => {
  try {
    const response = await axios.get(`${DEEPL_BASE_URL}/languages`, {
      params: {
        auth_key: DEEPL_API_KEY,
        type: 'target'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching languages:', error);
    res.status(500).json({ error: '言語リストの取得に失敗しました' });
  }
});

// API endpoint: Get logs (admin only)
app.get('/api/logs', async (req, res) => {
  try {
    const { password, date } = req.query;

    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({ error: '認証に失敗しました' });
    }

    const logDir = path.join(__dirname, 'logs');
    let files;

    try {
      files = await fs.readdir(logDir);
    } catch (err) {
      return res.json({ logs: [], message: 'ログファイルがありません' });
    }

    const jsonFiles = files.filter(f => f.endsWith('.json'));

    if (date) {
      const targetFile = `translations_${date}.json`;
      if (jsonFiles.includes(targetFile)) {
        const data = await fs.readFile(path.join(logDir, targetFile), 'utf8');
        return res.json({ logs: JSON.parse(data) });
      } else {
        return res.json({ logs: [], message: '指定された日付のログがありません' });
      }
    }

    // Return all logs
    const allLogs = [];
    for (const file of jsonFiles) {
      const data = await fs.readFile(path.join(logDir, file), 'utf8');
      allLogs.push(...JSON.parse(data));
    }

    res.json({ logs: allLogs });
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ error: 'ログの読み込みに失敗しました' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    apiKeyConfigured: !!DEEPL_API_KEY,
    apiEndpoint: DEEPL_BASE_URL,
    apiPlan: isFreePlan ? 'Free' : 'Pro'
  });
});

app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🚀 PDF Translator Server Started');
  console.log('='.repeat(50));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🔑 DeepL API Key: ${DEEPL_API_KEY ? '✓ Configured' : '✗ Missing'}`);
  console.log(`📡 API Endpoint: ${DEEPL_BASE_URL}`);
  console.log(`💳 API Plan: ${isFreePlan ? 'Free' : 'Pro'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('='.repeat(50));
});