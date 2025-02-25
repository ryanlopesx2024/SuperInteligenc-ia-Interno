import { useState, useRef, useEffect } from 'react'
import { 
  Box, 
  TextField, 
  Button, 
  Typography, 
  Container, 
  Paper,
  ThemeProvider,
  createTheme,
  CssBaseline,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Snackbar,
  Alert,
  IconButton,
  Divider,
  Avatar,
  CircularProgress,
  Tooltip
} from '@mui/material'
import { 
  Send as SendIcon, 
  Delete as DeleteIcon,
  PlayArrow as PlayArrowIcon
} from '@mui/icons-material';
import OpenAI from 'openai';
import jsPDF from 'jspdf';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#E2C074',
    },
    secondary: {
      main: '#1E1E1E',
    },
    background: {
      default: '#030409',
      paper: '#1A1C23',
    },
    text: {
      primary: '#ffffff',
      secondary: '#E2C074',
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#030409',
          margin: 0,
          padding: 0,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: '#1A1C23',
        },
      },
    },
  },
});

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  dangerouslyAllowBrowser: true
});

// Lista de assistentes disponíveis
const assistantTypes = {
  'Campanha de Google Ads': import.meta.env.VITE_ASSISTANT_CAMPAIGN_GOOGLE_ADS,
  'Landing Page Juridica': import.meta.env.VITE_ASSISTANT_LANDING_PAGE_JURIDICA,
};

// Tipos para o conteúdo das mensagens
interface TextContent {
  type: 'text';
  text: { value: string };
}

interface ImageContent {
  type: 'image_file';
  image_file: { url: string };
}

type MessageContent = TextContent | ImageContent;

interface Message {
  role: 'user' | 'assistant';
  content: MessageContent[];
  timestamp: number;
}

interface ConversationThread {
  messages: Message[];
  assistantId: string;
  threadId: string;
}

interface ConversationHistory {
  [assistantId: string]: ConversationThread;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAssistant, setSelectedAssistant] = useState<string>(Object.keys(assistantTypes)[0]);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error'>('success');
  const [currentThreadId, setCurrentThreadId] = useState<string>('');
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  // Carregar histórico ao iniciar
  useEffect(() => {
    const loadHistory = () => {
      const savedHistory = localStorage.getItem('conversationHistory');
      if (savedHistory) {
        const history: ConversationHistory = JSON.parse(savedHistory);
        const currentAssistant = history[selectedAssistant];
        if (currentAssistant) {
          setMessages(currentAssistant.messages);
          setCurrentThreadId(currentAssistant.threadId);
        }
      }
    };

    loadHistory();
  }, [selectedAssistant]);

  // Salvar histórico quando houver mudanças
  useEffect(() => {
    const saveHistory = () => {
      const savedHistory = localStorage.getItem('conversationHistory') || '{}';
      const history: ConversationHistory = JSON.parse(savedHistory);
      
      history[selectedAssistant] = {
        messages,
        assistantId: assistantTypes[selectedAssistant as keyof typeof assistantTypes],
        threadId: currentThreadId
      };

      localStorage.setItem('conversationHistory', JSON.stringify(history));
    };

    if (messages.length > 0) {
      saveHistory();
    }
  }, [messages, selectedAssistant, currentThreadId]);

  const handleAssistantChange = (newAssistant: string) => {
    setSelectedAssistant(newAssistant);
    const savedHistory = localStorage.getItem('conversationHistory');
    if (savedHistory) {
      const history: ConversationHistory = JSON.parse(savedHistory);
      const assistantHistory = history[newAssistant];
      if (assistantHistory) {
        setMessages(assistantHistory.messages);
        setCurrentThreadId(assistantHistory.threadId);
      } else {
        setMessages([]);
        setCurrentThreadId('');
      }
    }
    setSnackbarMessage('Assistente alterado');
    setSnackbarSeverity('success');
    setSnackbarOpen(true);
  };

  const clearHistory = () => {
    setMessages([]);
    setCurrentThreadId('');
    const savedHistory = localStorage.getItem('conversationHistory') || '{}';
    const history: ConversationHistory = JSON.parse(savedHistory);
    delete history[selectedAssistant];
    localStorage.setItem('conversationHistory', JSON.stringify(history));
    setSnackbarMessage('Histórico limpo');
    setSnackbarSeverity('success');
    setSnackbarOpen(true);
  };

  const getAssistantResponse = async (message: string): Promise<string> => {
    const assistantId = assistantTypes[selectedAssistant as keyof typeof assistantTypes];
    
    if (!assistantId) {
      return "Erro: ID do assistente não encontrado. Por favor, verifique a configuração.";
    }

    try {
      let threadId = currentThreadId;
      
      if (!threadId) {
        const thread = await openai.beta.threads.create();
        threadId = thread.id;
        setCurrentThreadId(threadId);
      }
      
      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: message
      });

      const run = await openai.beta.threads.runs.create(threadId, {
        assistant_id: assistantId,
      });

      let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
      
      while (runStatus.status !== "completed") {
        if (runStatus.status === "failed") {
          throw new Error("Execução do assistente falhou");
        }
        if (runStatus.status === "expired") {
          throw new Error("Execução do assistente expirou");
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
      }

      const messages = await openai.beta.threads.messages.list(threadId);
      const lastMessage = messages.data[0];
      
      if (lastMessage.role === "assistant") {
        const content = lastMessage.content[0];
        if (content.type === 'text') {
          return content.text.value;
        }
        throw new Error("Tipo de conteúdo não suportado");
      }
      
      throw new Error("Nenhuma mensagem do assistente encontrada");
    } catch (error) {
      console.error("Erro ao obter resposta do assistente:", error);
      return "Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.";
    }
  };

  const formatText = (text: string, maxWidth: number): string[] => {
    return text.split('\n').reduce((acc: string[], line: string) => {
      if (line.length <= maxWidth) {
        return [...acc, line];
      }
      
      const words = line.split(' ');
      let currentLine = '';
      
      words.forEach((word) => {
        if ((currentLine + word).length <= maxWidth) {
          currentLine += (currentLine ? ' ' : '') + word;
        } else {
          if (currentLine) acc.push(currentLine);
          currentLine = word;
        }
      });
      
      if (currentLine) acc.push(currentLine);
      return acc;
    }, []);
  };

  const exportToPDF = async () => {
    try {
      const doc = new jsPDF();
      
      // Configurações do documento
      const pageHeight = doc.internal.pageSize.height;
      const marginBottom = 20;
      let yPosition = 20;
      
      messages.forEach((msg) => {
        // Adiciona o remetente
        doc.setFont('helvetica', 'bold');
        doc.text(msg.role === 'user' ? 'Você:' : 'Assistente:', 20, yPosition);
        yPosition += 7;
        
        // Adiciona o conteúdo da mensagem
        doc.setFont('helvetica', 'normal');
        const content = msg.content[0];
        const messageText = content?.type === 'text' ? content.text.value : '[Conteúdo não textual]';
        const lines = formatText(messageText, 170);
        
        // Verifica se precisa de uma nova página
        if (yPosition + (lines.length * 7) + marginBottom > pageHeight) {
          doc.addPage();
          yPosition = 20;
        }
        
        lines.forEach((line: string) => {
          doc.text(line, 20, yPosition);
          yPosition += 7;
        });
        
        yPosition += 5; // Espaço entre mensagens
      });
      
      // Salva o PDF
      const filename = `Conversa com ${selectedAssistant} - ${new Date().toLocaleDateString()}.pdf`;
      doc.save(filename);

      setSnackbarMessage('Documento PDF exportado com sucesso!');
      setSnackbarSeverity('success');
      setSnackbarOpen(true);
    } catch (error) {
      console.error('Erro ao exportar para PDF:', error);
      setSnackbarMessage('Erro ao exportar o documento. Tente novamente.');
      setSnackbarSeverity('error');
      setSnackbarOpen(true);
    }
  };

  const handleStartClick = async () => {
    const startMessage = "COMEÇAR";
    const newMessage: Message = { 
      role: 'user', 
      content: [{ type: 'text', text: { value: startMessage } }],
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, newMessage]);
    setIsLoading(true);

    try {
      const assistantResponse = await getAssistantResponse(startMessage);
      const responseMessage: Message = {
        role: 'assistant',
        content: [{ type: 'text', text: { value: assistantResponse } }],
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, responseMessage]);
    } catch (error) {
      console.error('Erro:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: [{ type: 'text', text: { value: 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.' } }],
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = input;
    setInput('');

    // Verifica se a mensagem contém a palavra "DOCUMENTO"
    if (userMessage.toUpperCase().includes('DOCUMENTO')) {
      const newMessage: Message = { 
        role: 'user', 
        content: [{ type: 'text', text: { value: userMessage } }],
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, newMessage]);
      await exportToPDF();
      return; // Retorna sem enviar para a IA
    }

    // Se não contém DOCUMENTO, processa normalmente
    const newMessage: Message = { 
      role: 'user', 
      content: [{ type: 'text', text: { value: userMessage } }],
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, newMessage]);
    setIsLoading(true);

    try {
      const assistantResponse = await getAssistantResponse(userMessage);
      const responseMessage: Message = {
        role: 'assistant',
        content: [{ type: 'text', text: { value: assistantResponse } }],
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, responseMessage]);
    } catch (error) {
      console.error('Erro:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: [{ type: 'text', text: { value: 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.' } }],
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box 
        sx={{ 
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'background.default'
        }}
      >
        {/* Header */}
        <Box
          sx={{
            p: 2,
            borderBottom: '1px solid rgba(226, 192, 116, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#1A1C23',
          }}
        >
          <Typography 
            variant="h6" 
            sx={{ 
              color: '#E2C074',
              fontWeight: 600
            }}
          >
            Assistente Jurídico Interno
          </Typography>
          
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <FormControl 
              size="small" 
              sx={{ 
                minWidth: 200,
                '& .MuiOutlinedInput-root': {
                  borderColor: 'rgba(226, 192, 116, 0.3)',
                  '&:hover': {
                    borderColor: 'rgba(226, 192, 116, 0.5)',
                  },
                },
              }}
            >
              <Select
                value={selectedAssistant}
                onChange={(e) => setSelectedAssistant(e.target.value)}
                sx={{ 
                  color: '#E2C074',
                  '& .MuiSelect-icon': {
                    color: '#E2C074',
                  },
                }}
              >
                {Object.keys(assistantTypes).map((type) => (
                  <MenuItem 
                    key={type} 
                    value={type}
                    sx={{ 
                      color: 'text.primary',
                      '&:hover': {
                        backgroundColor: 'rgba(226, 192, 116, 0.1)',
                      },
                    }}
                  >
                    {type}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </Box>

        {/* Chat Area */}
        <Box 
          sx={{ 
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Messages */}
          <Box 
            sx={{ 
              flex: 1,
              overflowY: 'auto',
              p: 3,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
            ref={messagesEndRef}
          >
            {messages.map((message, index) => (
              <Box
                key={index}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: message.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <Box
                  sx={{
                    maxWidth: '80%',
                    p: 2,
                    borderRadius: 2,
                    backgroundColor: message.role === 'user' ? 'rgba(226, 192, 116, 0.1)' : '#1E1E1E',
                    border: '1px solid rgba(226, 192, 116, 0.1)',
                  }}
                >
                  <Typography
                    variant="body1"
                    sx={{
                      color: 'text.primary',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'break-word',
                    }}
                  >
                    {message.content[0].type === 'text' ? message.content[0].text.value : '[Conteúdo não textual]'}
                  </Typography>
                </Box>
              </Box>
            ))}
            {isLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
                <CircularProgress size={24} sx={{ color: '#E2C074' }} />
              </Box>
            )}
          </Box>

          {/* Input Area */}
          <Box
            component="form"
            onSubmit={handleSubmit}
            sx={{
              p: 2,
              borderTop: '1px solid rgba(226, 192, 116, 0.1)',
              backgroundColor: '#1A1C23',
              display: 'flex',
              gap: 1,
            }}
          >
            <TextField
              fullWidth
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Digite sua mensagem..."
              disabled={isLoading}
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: '#1E1E1E',
                  '& fieldset': {
                    borderColor: 'rgba(226, 192, 116, 0.3)',
                  },
                  '&:hover fieldset': {
                    borderColor: 'rgba(226, 192, 116, 0.5)',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#E2C074',
                  },
                },
                '& .MuiOutlinedInput-input': {
                  color: '#ffffff',
                },
              }}
            />
            <Button
              type="submit"
              disabled={isLoading || !input.trim()}
              sx={{
                minWidth: 'auto',
                backgroundColor: '#E2C074',
                color: '#1A1C23',
                '&:hover': {
                  backgroundColor: '#c4a666',
                },
                '&.Mui-disabled': {
                  backgroundColor: 'rgba(226, 192, 116, 0.3)',
                },
              }}
            >
              <SendIcon />
            </Button>
          </Box>
        </Box>
      </Box>

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSnackbarOpen(false)} 
          severity={snackbarSeverity}
          sx={{ 
            width: '100%',
            backgroundColor: snackbarSeverity === 'success' ? '#1E4620' : '#450A0A',
            color: '#ffffff',
          }}
        >
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </ThemeProvider>
  );
}

export default App;