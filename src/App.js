import React, { useState, useEffect, useRef } from 'react';

// Import Lucide React icons
import { MessageSquare, Image, Send, Copy, Edit, Reply, Upload, Sparkles, Wand2, Loader2, Info, TextCursorInput, X, PlusCircle } from 'lucide-react';

// Main App component
function App() {
  const [messages, setMessages] = useState([]); // Stores chat messages
  const [inputPrompt, setInputPrompt] = useState(''); // Current input for chat/image generation
  const [mode, setMode] = useState('chat'); // 'chat' or 'image'
  const [editingMessageId, setEditingMessageId] = useState(null); // ID of the message being edited
  const [imageForAnalysis, setImageForAnalysis] = useState(null); // Base64 encoded image for analysis
  const [imageGenerating, setImageGenerating] = useState(false); // Loading state for image generation
  const [chatLoading, setChatLoading] = useState(false); // Loading state for chat response
  const [analysisLoading, setAnalysisLoading] = useState(false); // Loading state for image analysis
  const [infoMessage, setInfoMessage] = useState(''); // State for displaying informational messages
  const messagesEndRef = useRef(null); // Ref for auto-scrolling chat

  const [showRefineMenu, setShowRefineMenu] = useState(false); // State for refine menu visibility
  const [refineTargetMessage, setRefineTargetMessage] = useState(null); // Message to be refined

  // States for selected refinement options (for text refinement)
  const [selectedLength, setSelectedLength] = useState(null);
  const [selectedClarity, setSelectedClarity] = useState(null);
  const [selectedTone, setSelectedTone] = useState(null);

  // State for selected image style and blur (for image refinement)
  const [selectedStyle, setSelectedStyle] = useState(null);
  const [selectedBlur, setSelectedBlur] = useState(null); // New state for blur option

  const apiKey = ""; // API key for Gemini API, will be provided by Canvas runtime

  // Auto-scroll to the bottom of the chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Function to show transient info messages
  const showInfoMessage = (message) => {
    setInfoMessage(message);
    setTimeout(() => setInfoMessage(''), 3000); // Clear message after 3 seconds
  };

  // Function to reset all chat states for a new chat
  const startNewChat = () => {
    setMessages([]);
    setInputPrompt('');
    setMode('chat'); // Default to chat mode for new chat
    setEditingMessageId(null);
    setImageForAnalysis(null);
    setImageGenerating(false);
    setChatLoading(false);
    setAnalysisLoading(false);
    setInfoMessage('');
    cancelRefine(); // Ensure refine menu is closed and states reset
    showInfoMessage('New chat started!');
  };

  // Handles sending a message or generating an image
  const handleSend = async () => {
    if (!inputPrompt.trim() && !imageForAnalysis) return;

    const currentTimestamp = new Date().toLocaleTimeString();
    const newUserMessageId = Date.now();

    const newUserMessage = {
      id: newUserMessageId,
      sender: 'user',
      text: inputPrompt,
      timestamp: currentTimestamp,
      image: imageForAnalysis // Attach image if it exists for analysis
    };

    let messagesAfterUserSend = [];
    let userMessageIdToLinkAIResponse = newUserMessageId; // Default for new messages

    if (editingMessageId) {
      // If editing an existing user message
      messagesAfterUserSend = messages.map(msg =>
        msg.id === editingMessageId ? { ...newUserMessage, id: editingMessageId } : msg
      );
      userMessageIdToLinkAIResponse = editingMessageId; // Link AI response to the edited message
      setEditingMessageId(null); // Clear editing state
    } else {
      // If sending a new user message
      messagesAfterUserSend = [...messages, newUserMessage];
    }

    setMessages(messagesAfterUserSend);
    setInputPrompt(''); // Clear input field
    setImageForAnalysis(null); // Clear image after sending

    if (mode === 'chat') {
      if (imageForAnalysis) {
        await analyzeImage(inputPrompt, imageForAnalysis);
      } else {
        // Normal chat response
        await getChatResponse(inputPrompt, messagesAfterUserSend, '', userMessageIdToLinkAIResponse);
      }
    } else { // Image mode
      await generateImage(inputPrompt);
    }
  };

  // Simulate AI chat response
  const getChatResponse = async (promptText, currentMessages, refinementInstruction = '', triggeringUserMessageId = null) => {
    setChatLoading(true);
    try {
      let chatHistory = currentMessages.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      }));

      let promptToSendToModel = promptText;
      if (refinementInstruction) {
        // When refining, instruct the model to refine the content of the target message
        promptToSendToModel = `Refine the following text by "${refinementInstruction}":\n\n"${refineTargetMessage.text}"`;
      }

      chatHistory.push({ role: "user", parts: [{ text: promptToSendToModel }] });

      const payload = { contents: chatHistory };
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();

      let aiResponseText = "I'm sorry, I couldn't get a response.";
      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        aiResponseText = result.candidates[0].content.parts[0].text;
      }

      if (refinementInstruction && refineTargetMessage) {
        // If refining an existing AI message, update it
        setMessages(prevMessages => prevMessages.map(msg =>
          msg.id === refineTargetMessage.id
            ? { ...msg, text: aiResponseText, timestamp: new Date().toLocaleTimeString(), refined: true }
            : msg
        ));
        setRefineTargetMessage(null); // Clear refine target after updating
      } else {
        // If adding a brand new AI response
        setMessages(prevMessages => [
          ...prevMessages,
          { id: Date.now(), sender: 'ai', text: aiResponseText, timestamp: new Date().toLocaleTimeString(), originalPromptId: triggeringUserMessageId }
        ]);
      }

    } catch (error) {
      console.error("Error fetching chat response:", error);
      setMessages(prevMessages => [
        ...prevMessages,
        { id: Date.now(), sender: 'ai', text: "Oops! Something went wrong getting a response.", timestamp: new Date().toLocaleTimeString() }
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  // Function to analyze an uploaded image
  const analyzeImage = async (prompt, base64ImageData) => {
    setAnalysisLoading(true);
    try {
      const payload = {
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/png", // Assuming PNG, but could be dynamic based on file type
                  data: base64ImageData.split(',')[1] // Remove 'data:image/png;base64,' prefix
                }
              }
            ]
          }
        ],
      };
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();

      let analysisText = "I'm sorry, I couldn't analyze the image.";
      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        analysisText = result.candidates[0].content.parts[0].text;
      }

      setMessages(prevMessages => [
        ...prevMessages,
        { id: Date.now(), sender: 'ai', text: analysisText, timestamp: new Date().toLocaleTimeString() }
      ]);

    } catch (error) {
      console.error("Error analyzing image:", error);
      setMessages(prevMessages => [
        ...prevMessages,
        { id: Date.now(), sender: 'ai', text: "Oops! Failed to analyze the image.", timestamp: new Date().toLocaleTimeString() }
      ]);
    } finally {
      setAnalysisLoading(false);
    }
  };


  // Simulate AI image generation
  const generateImage = async (prompt, isRefinement = false, targetMessageId = null) => {
    setImageGenerating(true);
    try {
      // If refining, the prompt should include the original prompt + style + blur instruction
      let promptToSend = prompt;
      if (isRefinement && refineTargetMessage?.originalImagePrompt) {
        let refinementPart = '';
        if (selectedStyle) {
          refinementPart += `, in a ${selectedStyle} style`;
        }
        if (selectedBlur) {
          refinementPart += `, with a ${selectedBlur}`;
        }
        promptToSend = `${refineTargetMessage.originalImagePrompt}${refinementPart}`;
      }

      const payload = { instances: { prompt: promptToSend }, parameters: { "sampleCount": 1 } };
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();

      let imageUrl = '';
      if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) {
        imageUrl = `data:image/png;base64,${result.predictions[0].bytesBase64Encoded}`;
      } else {
        imageUrl = 'https://placehold.co/400x300/CCCCCC/FFFFFF?text=Image+Failed'; // Fallback
      }

      if (isRefinement && targetMessageId) {
        // Update the existing image message
        let refinedText = `Generated image for: "${refineTargetMessage.originalImagePrompt}"`;
        if (selectedStyle) refinedText += ` (Style: ${selectedStyle})`;
        if (selectedBlur) refinedText += ` (Blur: ${selectedBlur})`;

        setMessages(prevMessages => prevMessages.map(msg =>
          msg.id === targetMessageId
            ? { ...msg, image: imageUrl, text: refinedText, timestamp: new Date().toLocaleTimeString(), refined: true }
            : msg
        ));
      } else {
        // Add a new image message, storing the original prompt
        setMessages(prevMessages => [
          ...prevMessages,
          { id: Date.now(), sender: 'ai', image: imageUrl, text: `Generated image for: "${prompt}"`, timestamp: new Date().toLocaleTimeString(), originalImagePrompt: prompt }
        ]);
      }

    } catch (error) {
      console.error("Error generating image:", error);
      setMessages(prevMessages => [
        ...prevMessages,
        { id: Date.now(), sender: 'ai', text: "Oops! Failed to generate image.", timestamp: new Date().toLocaleTimeString() }
      ]);
    } finally {
      setImageGenerating(false);
      cancelRefine(); // Always close menu after image generation/refinement
    }
  };


  // Handles copying message text to clipboard
  const handleCopy = (text) => {
    document.execCommand('copy', false, text);
    showInfoMessage('Message copied!');
  };

  // Handles setting up a reply
  const handleReply = (text) => {
    setInputPrompt(`Replying to: "${text.substring(0, 50)}..."\n`);
    showInfoMessage('Input prepared for reply.');
  };

  // Handles editing a user's message
  const handleEdit = (messageId, currentText) => {
    setEditingMessageId(messageId);
    setInputPrompt(currentText);
    showInfoMessage('Editing message. Send to confirm.');
  };

  // Handles image file upload for analysis
  const handleImageUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageForAnalysis(reader.result); // result is base64
        showInfoMessage('Image uploaded for analysis. Type your prompt and send.');
      };
      reader.readAsDataURL(file);
    }
  };

  // Opens the refine menu for a specific message
  const openRefineMenu = (message) => {
    setRefineTargetMessage(message);
    // Reset selections based on message type
    if (message.image) {
      setSelectedStyle(null);
      setSelectedBlur(null); // Reset blur too
    } else {
      setSelectedLength(null);
      setSelectedClarity(null);
      setSelectedTone(null);
    }
    setShowRefineMenu(true);
  };

  // Confirms refinement and sends the request to the AI
  const confirmRefine = () => {
    if (refineTargetMessage) {
      if (refineTargetMessage.image) {
        // Image refinement logic
        if (selectedStyle || selectedBlur) { // Check if any image option is selected
          generateImage(refineTargetMessage.originalImagePrompt, true, refineTargetMessage.id);
        } else {
          showInfoMessage('Please select at least one image refinement option.');
        }
      } else {
        // Text refinement logic
        let refinementInstruction = '';
        if (selectedLength) {
          refinementInstruction += `make it ${selectedLength}. `;
        }
        if (selectedClarity) {
          refinementInstruction += `make it ${selectedClarity}. `;
        }
        if (selectedTone) {
          refinementInstruction += `make the tone ${selectedTone}. `;
        }

        if (refinementInstruction.trim() !== '') {
          const finalInstruction = refinementInstruction.trim();
          getChatResponse(refineTargetMessage.text, messages, finalInstruction, refineTargetMessage.originalPromptId);
        } else {
          showInfoMessage('No refinement options selected.');
        }
      }
    }
    // Always close menu and reset selections after confirming or cancelling
    cancelRefine();
  };

  // Cancels refinement and closes the menu
  const cancelRefine = () => {
    setShowRefineMenu(false);
    setRefineTargetMessage(null);
    setSelectedLength(null);
    setSelectedClarity(null);
    setSelectedTone(null);
    setSelectedStyle(null);
    setSelectedBlur(null); // Reset blur state
  };

  // Handlers for suggestion buttons
  const handleSuggestionClick = (suggestion) => {
    setInputPrompt(suggestion);
  };

  // Define suggestion buttons based on mode
  const chatSuggestions = [
    "Tell me a joke.",
    "Give me a good dessert recipe.",
    "Provide a riddle."
  ];

  const imageSuggestions = [
    "A dog eating vanilla ice cream with dog treats.",
    "Homer Simpson bowling in a bowling alley.",
    "School of fish swimming in a coral reef."
  ];

  const currentSuggestions = mode === 'chat' ? chatSuggestions : imageSuggestions;


  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-blue-50 to-indigo-100 font-inter antialiased">
      {/* Header and Mode Switch */}
      <header className="p-4 bg-white shadow-lg flex items-center justify-between rounded-b-xl">
        <h1 className="text-3xl font-extrabold text-gray-800 flex items-center">
          <Sparkles className="inline-block mr-2 text-blue-500" size={30} /> Firon
        </h1>
        {/* New Chat Button */}
        <button
          onClick={startNewChat}
          className="py-2 px-4 rounded-full bg-blue-500 text-white flex items-center justify-center hover:bg-blue-600 transition-colors duration-200 shadow-md mr-auto ml-4"
          title="Start a new chat"
        >
          <PlusCircle size={20} className="mr-2" /> New Chat
        </button>
        <div className="flex space-x-3">
          <button
            onClick={() => { setMode('chat'); cancelRefine(); setEditingMessageId(null); setInputPrompt(''); setImageForAnalysis(null); }}
            className={`py-2 px-5 rounded-full text-lg font-semibold transition-all duration-300 ease-in-out
              ${mode === 'chat' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-blue-100'}`}
          >
            <MessageSquare className="inline-block mr-2" size={20} /> Chat Mode
          </button>
          <button
            onClick={() => { setMode('image'); cancelRefine(); setEditingMessageId(null); setInputPrompt(''); setImageForAnalysis(null); }}
            className={`py-2 px-5 rounded-full text-lg font-semibold transition-all duration-300 ease-in-out
              ${mode === 'image' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-blue-100'}`}
          >
            <Image className="inline-block mr-2" size={20} /> Image Mode
          </button>
        </div>
      </header>

      {/* Info Message Display */}
      {infoMessage && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-sm px-4 py-2 rounded-lg shadow-lg flex items-center z-50">
          <Info className="mr-2" size={16} /> {infoMessage}
        </div>
      )}

      {/* Refine Menu Pop-up */}
      {showRefineMenu && refineTargetMessage && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-2xl relative w-80 max-w-sm">
            <button
              onClick={cancelRefine}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-800 transition-colors"
            >
              <X size={24} />
            </button>
            <h3 className="text-xl font-semibold mb-4 text-gray-800">Refine Response</h3>

            {refineTargetMessage.image ? (
              // Image Refinement Options
              <div className="space-y-3">
                <div>
                  <p className="font-medium text-gray-700 mb-1">Style</p>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setSelectedStyle('realistic')}
                      className={`flex-1 py-2 px-4 rounded-full transition-colors ${selectedStyle === 'realistic' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-blue-100'}`}
                    >
                      Realistic
                    </button>
                    <button
                      onClick={() => setSelectedStyle('drawn cartoon')}
                      className={`flex-1 py-2 px-4 rounded-full transition-colors ${selectedStyle === 'drawn cartoon' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-blue-100'}`}
                    >
                      Drawn Cartoon
                    </button>
                    <button
                      onClick={() => setSelectedStyle('3d cartoon')}
                      className={`flex-1 py-2 px-4 rounded-full transition-colors ${selectedStyle === '3d cartoon' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-blue-100'}`}
                    >
                      3D Cartoon
                    </button>
                  </div>
                </div>
                <div>
                  <p className="font-medium text-gray-700 mb-1">Blur</p>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setSelectedBlur('blurry background')}
                      className={`flex-1 py-2 px-4 rounded-full transition-colors ${selectedBlur === 'blurry background' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-blue-100'}`}
                    >
                      Blurry Background
                    </button>
                    <button
                      onClick={() => setSelectedBlur('blurry foreground')}
                      className={`flex-1 py-2 px-4 rounded-full transition-colors ${selectedBlur === 'blurry foreground' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-blue-100'}`}
                    >
                      Blurry Foreground
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              // Text Refinement Options
              <div className="space-y-3">
                <div>
                  <p className="font-medium text-gray-700 mb-1">Length</p>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setSelectedLength('shorter')}
                      className={`flex-1 py-2 px-4 rounded-full transition-colors ${selectedLength === 'shorter' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-blue-100'}`}
                    >
                      Shorter
                    </button>
                    <button
                      onClick={() => setSelectedLength('longer')}
                      className={`flex-1 py-2 px-4 rounded-full transition-colors ${selectedLength === 'longer' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-blue-100'}`}
                    >
                      Longer
                    </button>
                  </div>
                </div>

                <div>
                  <p className="font-medium text-gray-700 mb-1">Clarity</p>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setSelectedClarity('more concise')}
                      className={`flex-1 py-2 px-4 rounded-full transition-colors ${selectedClarity === 'more concise' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-blue-100'}`}
                    >
                      More Concise
                    </button>
                    <button
                      onClick={() => setSelectedClarity('more detailed')}
                      className={`flex-1 py-2 px-4 rounded-full transition-colors ${selectedClarity === 'more detailed' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-blue-100'}`}
                    >
                      More Detailed
                    </button>
                  </div>
                </div>

                <div>
                  <p className="font-medium text-gray-700 mb-1">Tone</p>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setSelectedTone('more casual')}
                      className={`flex-1 py-2 px-4 rounded-full transition-colors ${selectedTone === 'more casual' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-blue-100'}`}
                    >
                      More Casual
                    </button>
                    <button
                      onClick={() => setSelectedTone('more professional')}
                      className={`flex-1 py-2 px-4 rounded-full transition-colors ${selectedTone === 'more professional' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-blue-100'}`}
                    >
                      More Professional
                    </button>
                  </div>
                </div>
              </div>
            )}


            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={cancelRefine}
                className="py-2 px-5 rounded-full bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors duration-200 shadow-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmRefine}
                className="py-2 px-5 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-200 shadow-md"
              >
                Refine
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`flex flex-col max-w-[70%] p-3 rounded-xl shadow-md
              ${msg.sender === 'user' ? 'bg-blue-500 text-white rounded-br-none' : 'bg-white text-gray-800 rounded-bl-none'}`}
            >
              {msg.image && (
                <img
                  src={msg.image}
                  alt={msg.sender === 'user' ? 'Uploaded for analysis' : 'Generated image'}
                  className="w-full h-auto rounded-lg mb-2 object-cover max-h-64"
                  onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/300x200/CCCCCC/FFFFFF?text=Image+Load+Error'; }}
                />
              )}
              <p className="text-sm break-words whitespace-pre-wrap">{msg.text}</p>
              <div className={`flex items-center text-xs mt-1 ${msg.sender === 'user' ? 'text-blue-200' : 'text-gray-500'} justify-between`}>
                <span>{msg.timestamp} {msg.refined && '(Refined)'}</span>
                <div className="flex space-x-1 ml-3">
                  <button
                    onClick={() => handleCopy(msg.text)}
                    className={`p-1 rounded-full ${msg.sender === 'user' ? 'hover:bg-blue-600' : 'hover:bg-gray-200'} transition-colors duration-200`}
                    title="Copy"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => handleReply(msg.text)}
                    className={`p-1 rounded-full ${msg.sender === 'user' ? 'hover:bg-blue-600' : 'hover:bg-gray-200'} transition-colors duration-200`}
                    title="Reply"
                  >
                    <Reply size={14} />
                  </button>
                  {msg.sender === 'user' && (
                    <button
                      onClick={() => handleEdit(msg.id, msg.text)}
                      className="p-1 rounded-full hover:bg-blue-600 transition-colors duration-200"
                      title="Edit"
                    >
                      <Edit size={14} />
                    </button>
                  )}
                  {msg.sender === 'ai' && ( // Refine button for both text and image AI responses
                    <button
                      onClick={() => openRefineMenu(msg)}
                      className="p-1 rounded-full hover:bg-gray-200 transition-colors duration-200"
                      title="Refine"
                    >
                      <TextCursorInput size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}

        {(chatLoading || imageGenerating || analysisLoading) && (
          <div className="flex justify-center my-4">
            <Loader2 className="animate-spin text-blue-500" size={32} />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area and Suggestion Buttons */}
      <div className="p-4 bg-white shadow-inner rounded-t-xl">
        {/* Suggestion Buttons */}
        <div className="flex justify-center space-x-2 mb-3 overflow-x-auto pb-2 scrollbar-hide">
          {currentSuggestions.map((suggestion, index) => (
            <button
              key={index}
              onClick={() => handleSuggestionClick(suggestion)}
              className="flex-shrink-0 px-4 py-2 rounded-full bg-blue-100 text-blue-700 text-sm font-medium hover:bg-blue-200 transition-colors duration-200 shadow-sm"
            >
              {suggestion}
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-3">
          {mode === 'chat' && (
            <label htmlFor="image-upload" className="cursor-pointer p-3 rounded-full bg-gray-200 text-gray-700 hover:bg-blue-100 transition-colors duration-200 shadow-sm" title="Upload Image for Analysis">
              <Upload size={24} />
              <input
                id="image-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
            </label>
          )}

          {imageForAnalysis && (
            <div className="relative p-2 bg-blue-100 rounded-lg flex items-center">
              <span className="text-sm text-blue-700">Image attached for analysis</span>
              <button
                onClick={() => setImageForAnalysis(null)}
                className="ml-2 text-blue-700 hover:text-red-500 transition-colors"
                title="Remove Image"
              >
                &times;
              </button>
            </div>
          )}

          <input
            type="text"
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder={
              mode === 'chat'
                ? (imageForAnalysis ? 'Describe your image or ask a question...' : 'Type your message...')
                : 'Describe the image you want to generate...'
            }
            className="flex-1 p-3 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent text-gray-700 placeholder-gray-500 shadow-sm"
          />

          <button
            onClick={handleSend}
            className="p-3 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-200 shadow-md transform active:scale-95"
            title={mode === 'chat' ? 'Send Message' : 'Generate Image'}
            disabled={!inputPrompt.trim() && !imageForAnalysis || chatLoading || imageGenerating || analysisLoading}
          >
            {mode === 'chat' ? (
              <Send size={24} />
            ) : (
              <Wand2 size={24} />
            )}
          </button>
        </div>
      </div>

      {/* Custom Scrollbar Styles */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f5f9; /* Tailwind gray-100 */
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #9ca3af; /* Tailwind gray-400 */
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #60a5fa; /* Tailwind blue-400 */
        }
        body {
          font-family: 'Inter', sans-serif;
        }
        /* Hide scrollbar for suggestion buttons on small screens */
        .scrollbar-hide::-webkit-scrollbar {
            display: none;
        }
        .scrollbar-hide {
            -ms-overflow-style: none;  /* IE and Edge */
            scrollbar-width: none;  /* Firefox */
        }
      `}</style>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
    </div>
  );
}

export default App;
