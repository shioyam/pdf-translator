const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

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
app.use(cors({
  origin: '*', // Allow all origins for now
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
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

// Download font if not exists
async function ensureJapaneseFont() {
  const fontDir = path.join(__dirname, 'fonts');
  const fontPath = path.join(fontDir, 'NotoSansJP-Regular.ttf');
  
  try {
    // Check if font already exists
    await fs.access(fontPath);
    console.log('✓ Japanese font already exists');
    const fontBytes = await fs.readFile(fontPath);
    return fontBytes;
  } catch (error) {
    console.log('⬇ Downloading Japanese font from Google Fonts...');
    
    try {
      // Create fonts directory
      await fs.mkdir(fontDir, { recursive: true });
      
      // Download Noto Sans JP from reliable CDN
      const fontUrl = 'https://github.com/google/fonts/raw/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf';
      const response = await axios.get(fontUrl, { 
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024 // 50MB
      });
      
      // Save font file
      await fs.writeFile(fontPath, Buffer.from(response.data));
      console.log('✓ Japanese font downloaded and saved');
      
      return Buffer.from(response.data);
    } catch (downloadError) {
      console.error('✗ Failed to download font:', downloadError.message);
      throw new Error('日本語フォントのダウンロードに失敗しました');
    }
  }
}

// Create translated PDF - overlay on original pages with complete white background
async function createTranslatedPDF(originalBuffer, translatedText) {
  try {
    console.log('📄 Creating PDF with full translation overlay. Text length:', translatedText.length);
    
    // Get Japanese font bytes
    const fontBytes = await ensureJapaneseFont();
    
    // Load the original PDF
    const originalPdf = await PDFDocument.load(originalBuffer);
    const originalPages = originalPdf.getPages();
    const originalPageCount = originalPages.length;
    
    console.log(`📑 Original PDF has ${originalPageCount} pages`);
    
    // Register fontkit
    originalPdf.registerFontkit(fontkit);
    
    // Embed the Japanese font
    console.log('🔤 Embedding Japanese font...');
    const customFont = await originalPdf.embedFont(fontBytes);
    console.log('✓ Font embedded successfully');
    
    // Prepare text rendering
    const fontSize = 11;
    const lineHeight = fontSize * 1.6;
    const margin = 50;
    
    // Split text into paragraphs
    const paragraphs = translatedText.split('\n');
    
    console.log(`📝 Processing ${paragraphs.length} paragraphs`);
    
    let currentPageIndex = 0;
    let currentPage = null;
    let y = 0;
    
    // Function to prepare a page for writing
    const preparePage = () => {
      if (currentPageIndex < originalPageCount) {
        // Use existing page
        currentPage = originalPages[currentPageIndex];
      } else {
        // Add new page with same size as first page
        const firstPage = originalPages[0];
        const { width, height } = firstPage.getSize();
        currentPage = originalPdf.addPage([width, height]);
      }
      
      const { width, height } = currentPage.getSize();
      
      // Cover entire page with white rectangle to hide original text
      currentPage.drawRectangle({
        x: 0,
        y: 0,
        width: width,
        height: height,
        color: rgb(1, 1, 1),
        opacity: 1.0 // Completely opaque
      });
      
      currentPageIndex++;
      y = height - margin;
      
      return { width, height };
    };
    
    // Start with first page
    let { width, height } = preparePage();
    const maxWidth = width - (margin * 2);
    
    // Render all paragraphs
    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) {
        y -= lineHeight * 0.5; // Small space for empty lines
        continue;
      }
      
      // Wrap text to fit page width
      const words = paragraph.split(/\s+/);
      let currentLine = '';
      
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const testLine = currentLine + (currentLine ? ' ' : '') + word;
        const textWidth = customFont.widthOfTextAtSize(testLine, fontSize);
        
        if (textWidth < maxWidth) {
          currentLine = testLine;
        } else {
          // Draw current line
          if (currentLine) {
            // Check if we need a new page
            if (y < margin + lineHeight) {
              const pageInfo = preparePage();
              width = pageInfo.width;
              height = pageInfo.height;
            }
            
            currentPage.drawText(currentLine, {
              x: margin,
              y: y,
              size: fontSize,
              font: customFont,
              color: rgb(0, 0, 0)
            });
            
            y -= lineHeight;
          }
          currentLine = word;
        }
      }
      
      // Draw remaining line
      if (currentLine) {
        // Check if we need a new page
        if (y < margin + lineHeight) {
          const pageInfo = preparePage();
          width = pageInfo.width;
          height = pageInfo.height;
        }
        
        currentPage.drawText(currentLine, {
          x: margin,
          y: y,
          size: fontSize,
          font: customFont,
          color: rgb(0, 0, 0)
        });
        
        y -= lineHeight * 1.3; // Extra space between paragraphs
      }
    }
    
    const finalPageCount = originalPdf.getPageCount();
    console.log(`✓ Translation complete. Final PDF: ${finalPageCount} pages (original: ${originalPageCount})`);
    
    const pdfBytes = await originalPdf.save();
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error('PDF creation error:', error);
    console.error('Error stack:', error.stack);
    throw new Error('翻訳済みPDFの作成に失敗しました: ' + error.message);
  }
}

// API endpoint: Translate PDF
app.post('/api/translate', upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  try {
    console.log('='.repeat(50));
    console.log('📥 New translation request received');
    
    if (!req.file) {
      console.log('❌ No file uploaded');
      return res.status(400).json({ error: 'ファイルがアップロードされていません' });
    }

    console.log('📄 File:', req.file.originalname, '- Size:', (req.file.size / 1024).toFixed(2), 'KB');

    const { targetLang, sourceLang } = req.body;

    if (!targetLang) {
      console.log('❌ No target language specified');
      return res.status(400).json({ error: '翻訳先言語が指定されていません' });
    }

    console.log('🌐 Translation:', sourceLang || 'auto', '→', targetLang);

    const clientIp = getClientIp(req);
    console.log(`🔍 Client IP: ${clientIp}`);

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

    console.log('Translation successful. Translated text length:', translatedText.length);

    // Check if user wants JSON response or PDF
    const outputFormat = req.body.format || 'pdf';

    if (outputFormat === 'json') {
      // Return JSON with both original and translated text
      await logTranslation(
        clientIp,
        detectedSourceLang || sourceLang || 'auto',
        targetLang,
        pdfData.pageCount,
        pdfData.text.length,
        req.file.originalname
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ Translation completed in ${elapsed}s (JSON format)`);
      console.log('='.repeat(50));

      return res.json({
        success: true,
        originalText: pdfData.text,
        translatedText: translatedText,
        sourceLanguage: detectedSourceLang || sourceLang || 'auto',
        targetLanguage: targetLang,
        pageCount: pdfData.pageCount,
        characterCount: pdfData.text.length
      });
    }

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
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Translation completed in ${elapsed}s`);
    console.log('='.repeat(50));

  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ Translation failed after ${elapsed}s:`, error.message);
    console.error('Error stack:', error.stack);
    console.log('='.repeat(50));
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

// API endpoint: Translate text (new)
app.post('/api/translate-text', async (req, res) => {
  const startTime = Date.now();
  try {
    console.log('='.repeat(50));
    console.log('📝 Text translation request received');

    const { text, targetLang, sourceLang } = req.body;

    if (!text || !text.trim()) {
      console.log('❌ No text provided');
      return res.status(400).json({ error: 'テキストが入力されていません' });
    }

    if (!targetLang) {
      console.log('❌ No target language specified');
      return res.status(400).json({ error: '翻訳先言語が指定されていません' });
    }

    if (text.length > 5000) {
      console.log('❌ Text too long:', text.length);
      return res.status(400).json({ error: 'テキストが長すぎます（最大5000文字）' });
    }

    const clientIp = getClientIp(req);
    console.log(`🔍 Client IP: ${clientIp}`);
    console.log(`📏 Text length: ${text.length} characters`);
    console.log(`🌐 Translation: ${sourceLang || 'auto'} → ${targetLang}`);

    // Translate text
    const { translatedText, detectedSourceLang } = await translateText(
      text,
      targetLang,
      sourceLang
    );

    console.log(`✅ Translation successful. Output length: ${translatedText.length}`);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️ Completed in ${elapsed}s`);
    console.log('='.repeat(50));

    res.json({
      success: true,
      translatedText: translatedText,
      detectedSourceLang: detectedSourceLang,
      characterCount: text.length
    });

  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ Text translation failed after ${elapsed}s:`, error.message);
    console.log('='.repeat(50));
    res.status(500).json({
      error: error.message || 'テキスト翻訳中にエラーが発生しました'
    });
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
  console.log('❤️ Health check from:', getClientIp(req));
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    apiKeyConfigured: !!DEEPL_API_KEY,
    apiEndpoint: DEEPL_BASE_URL,
    apiPlan: isFreePlan ? 'Free' : 'Pro',
    uptime: process.uptime()
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