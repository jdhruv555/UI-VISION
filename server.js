const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { Groq } = require('groq-sdk');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();
const port = 3001;

// Enable detailed logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Groq API configuration
const GROQ_API_KEY = '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';
const groq = new Groq({ apiKey: GROQ_API_KEY });

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100 
});
app.use(limiter);

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `screenshot-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } 
});

// Fallback component generation
function generateFallbackComponent(imageAnalysis) {
  return `
import React from 'react';
import PropTypes from 'prop-types';

const GeneratedComponent = ({ className }) => {
  return (
    <div className={"p-4 bg-gray-100 rounded-lg shadow-md " + className}>
      <h2 className="text-xl font-bold mb-4">Generated Component</h2>
      <p className="text-gray-600">
        {/* Placeholder content based on image analysis */}
        {/* Image Analysis: ${imageAnalysis.substring(0, 100)}... */}
      </p>
    </div>
  );
};

GeneratedComponent.propTypes = {
  className: PropTypes.string
};

GeneratedComponent.defaultProps = {
  className: ''
};

export default GeneratedComponent;
`;
}

// Image layout analysis
function analyzeImageLayout(imageBase64) {
  return `
    The image shows a user interface that needs to be converted into a React component.
    Please analyze the visual elements and create a responsive React component with:
    - Semantic HTML structure
    - Tailwind CSS for styling
    - Proper spacing and alignment
    - Responsive design considerations
    - Accessibility features
  `;
}

// Main analysis route
app.post('/api/analyze', upload.single('screenshot'), async (req, res) => {
  try {
    // Validate file upload
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate file type
    if (!req.file.mimetype.startsWith('image/')) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid file type. Please upload an image.' });
    }

    const image = fs.readFileSync(req.file.path, { encoding: 'base64' });
    const imageAnalysis = analyzeImageLayout(image);

    try {
      const completion = await groq.chat.completions.create({
        model: "mixtral-8x7b-32768",
        messages: [
          {
            role: "system",
            content: `You are an expert React developer specializing in converting UI designs into clean, maintainable React components.`
          },
          {
            role: "user",
            content: `Create a React component based on this UI layout description: ${imageAnalysis}
            
            Requirements:
            1. Use Tailwind CSS for styling
            2. Make it responsive
            3. Include proper aria labels
            4. Handle interactive states
            5. Return only the component code`
          }
        ],
        temperature: 0.3,
        max_tokens: 4096,
        top_p: 1,
        stream: false
      });

      // Clean up uploaded file
      fs.unlinkSync(req.file.path);

      // Extract component code
      let componentCode = completion.choices[0].message.content.trim();
      if (componentCode.includes('```')) {
        componentCode = componentCode.split('```')[1]
          .replace('jsx', '')
          .replace('react', '')
          .trim();
      }

      if (!componentCode) {
        throw new Error('No component code generated');
      }

      res.json({ component: componentCode });

    } catch (groqError) {
      console.error('Groq API Error:', groqError);
      
      // Fallback mechanism
      const fallbackComponent = generateFallbackComponent(imageAnalysis);
      
      // Clean up file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      res.status(429).json({ 
        component: fallbackComponent,
        message: 'API rate limit exceeded. Generated a basic fallback component.',
        error: groqError.message
      });
    }
  } catch (error) {
    console.error('Error in /api/analyze:', error);
    
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ 
      error: `Failed to process the screenshot: ${error.message}`,
      details: error.stack
    });
  }
});

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString() 
  });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Using Groq API with key: ${GROQ_API_KEY.substring(0, 10)}...`);
});
