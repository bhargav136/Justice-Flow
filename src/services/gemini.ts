import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const analyzeLegalDocument = async (fileName: string, textContent: string, images?: { data: string, mimeType: string }[]) => {
  const parts: any[] = [
    {
      text: `Role: You are the Intelligent Backend for "JusticeFlow AI." Your primary job is to handle the file processing logic once a user clicks "Confirm Entry."

Task: Process the uploaded document: "${fileName}" and any embedded or attached images. Perform a comprehensive legal and forensic audit.

Capabilities to Execute:
1. Massive Context Understanding: Read the entire document. Use your 1M+ token window to ensure all pages are analyzed.
2. Automated Verification: Trigger a full audit covering:
   - Document Summary: Key facts and legal issues.
   - Evidence Forensics: Scan all embedded images or documents for AI manipulation/Deepfakes. Provide a 'Real vs Fake' verdict.
   - AI Detection: For each image, calculate the probability of it being AI-generated vs human-generated (True image).
   - Event Timeline: Extract dates and map them chronologically.
   - Legal Points: Extract critical legal arguments and applicable laws.

System Instructions:
- Maintain strict judicial neutrality.
- Provide technical reasons for evidence authenticity scores.
- Output MUST be in JSON format.

Output Constraint (Strict JSON):
{
  "summary": "...",
  "timeline": [{"date": "...", "event": "...", "description": "..."}],
  "evidence_audit": [{
    "description": "...",
    "verdict": "Real/Fake",
    "ai_probability": 0-100,
    "true_probability": 0-100,
    "forensic_notes": "..."
  }],
  "legal_points": ["...", "..."]
}

Document Content:
${textContent}`
    }
  ];

  if (images && images.length > 0) {
    images.forEach(img => {
      parts.push({
        inlineData: {
          data: img.data,
          mimeType: img.mimeType
        }
      });
    });
  }

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ parts }],
    config: {
      systemInstruction: "You are JusticeFlow AI, a sophisticated Judicial Intelligence Assistant. Your task is to analyze legal documents and provide structured insights with judicial neutrality. Output MUST be in JSON format.",
      responseMimeType: "application/json"
    }
  });

  return JSON.parse(response.text || "{}");
};

export const chatWithCase = async (documentContent: string, history: { role: 'user' | 'assistant', content: string }[], message: string) => {
  const chat = ai.chats.create({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction: `You are JusticeFlow AI, a Judicial Intelligence Assistant. You are assisting a Magistrate in analyzing legal documents. 
      Answer questions based on the document content provided. Be precise, professional, and cite specific sections of the document when possible.
      Document Content: ${documentContent}`
    },
    history: history.map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    }))
  });

  const response = await chat.sendMessage({ message });
  return response.text;
};
