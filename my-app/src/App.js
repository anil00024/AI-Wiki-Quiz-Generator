import React, { useState, useEffect } from 'react';
import { AlertCircle, Loader2, BookOpen, History, CheckCircle, XCircle, Sparkles, Brain, Zap, Award, TrendingUp } from 'lucide-react';

const App = () => {
  const [activeTab, setActiveTab] = useState('generate');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [quizData, setQuizData] = useState(null);
  const [history, setHistory] = useState([]);
  const [selectedQuiz, setSelectedQuiz] = useState(null);
  const [userAnswers, setUserAnswers] = useState({});
  const [showResults, setShowResults] = useState(false);
  const [robotState, setRobotState] = useState('idle');
  const [loadingStatus, setLoadingStatus] = useState('');

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    if (loading) {
      setRobotState('thinking');
    } else if (showResults) {
      setRobotState('celebrating');
    } else {
      setRobotState('idle');
    }
  }, [loading, showResults]);

  const loadHistory = async () => {
    try {
      const result = await window.storage.list('quiz:');
      if (result && result.keys) {
        const historyData = [];
        for (const key of result.keys) {
          try {
            const data = await window.storage.get(key);
            if (data && data.value) {
              historyData.push(JSON.parse(data.value));
            }
          } catch (err) {
            console.log('Error loading quiz:', key);
          }
        }
        setHistory(historyData.sort((a, b) => b.id - a.id));
      }
    } catch (err) {
      console.log('No history found yet');
    }
  };

  // STEP 1: Extract Wikipedia article content using JSONP to avoid CORS
  const extractWikipediaContent = async (wikiUrl) => {
    try {
      setLoadingStatus('Fetching Wikipedia article...');
      
      // STEP 2: Extract the article title from the URL
      // Example: "https://en.wikipedia.org/wiki/Albert_Einstein" → "Albert_Einstein"
      const urlParts = wikiUrl.split('/wiki/');
      if (urlParts.length < 2) {
        throw new Error('Invalid Wikipedia URL format');
      }
      
      const articleTitle = decodeURIComponent(urlParts[1]);
      
      // STEP 3: Use JSONP technique (works around CORS restrictions)
      return new Promise((resolve, reject) => {
        // STEP 3a: Create a unique callback function name
        const callbackName = 'wikiCallback_' + Date.now();
        
        // STEP 3b: Create a new <script> element
        const script = document.createElement('script');
        
        // STEP 3c: Define the callback function that Wikipedia will call
        window[callbackName] = (data) => {
          // STEP 3d: Clean up - remove script and callback after use
          document.head.removeChild(script);
          delete window[callbackName];
          
          try {
            // STEP 3e: Validate the received data
            if (!data.query || !data.query.pages) {
              reject(new Error('Article not found'));
              return;
            }
            
            // STEP 3f: Extract page data from Wikipedia response
            const pages = data.query.pages;
            const pageId = Object.keys(pages)[0];
            
            // STEP 3g: Check if article exists
            if (pageId === '-1') {
              reject(new Error('Article not found. Please check the URL.'));
              return;
            }
            
            const page = pages[pageId];
            
            // STEP 3h: Return the article data
            resolve({
              title: page.title,
              extract: page.extract || 'No content available.',
              description: page.pageprops?.['wikibase-shortdesc'] || ''
            });
          } catch (err) {
            reject(err);
          }
        };
        
        // STEP 3i: Build Wikipedia API URL with JSONP callback
        // The '&callback=' parameter tells Wikipedia to wrap response in our function
        const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|pageprops&exintro=1&explaintext=1&titles=${encodeURIComponent(articleTitle)}&callback=${callbackName}`;
        
        // STEP 3j: Set script source to the API URL
        script.src = apiUrl;
        
        // STEP 3k: Handle network errors
        script.onerror = () => {
          document.head.removeChild(script);
          delete window[callbackName];
          reject(new Error('Failed to load Wikipedia data. Network error or CORS issue.'));
        };
        
        // STEP 3l: Add script to page (this triggers the request)
        document.head.appendChild(script);
        
        // STEP 3m: Set timeout to prevent hanging forever
        setTimeout(() => {
          if (window[callbackName]) {
            document.head.removeChild(script);
            delete window[callbackName];
            reject(new Error('Request timed out. Please try again.'));
          }
        }, 10000); // 10 second timeout
      });
    } catch (err) {
      throw new Error(`Failed to fetch Wikipedia content: ${err.message}`);
    }
  };

  const generateQuiz = async () => {
    if (!url.trim()) {
      setError('Please enter a Wikipedia URL');
      return;
    }

    if (!url.includes('wikipedia.org/wiki/')) {
      setError('Please enter a valid Wikipedia URL (e.g., https://en.wikipedia.org/wiki/Article_Name)');
      return;
    }

    setLoading(true);
    setError('');
    setQuizData(null);
    setLoadingStatus('Starting...');

    try {
      // Step 1: Fetch Wikipedia content with timeout
      let wikiContent;
      try {
        const fetchPromise = extractWikipediaContent(url);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timed out. Please try again.')), 15000)
        );
        wikiContent = await Promise.race([fetchPromise, timeoutPromise]);
      } catch (fetchError) {
        throw new Error(`Wikipedia fetch failed: ${fetchError.message}. Try using the mobile link or check your internet connection.`);
      }
      
      if (!wikiContent || !wikiContent.extract || wikiContent.extract.length < 50) {
        throw new Error('Article content is too short or empty. Please try a different article.');
      }
      
      // Step 2: Generate quiz using Claude API
      setLoadingStatus('Generating quiz questions...');
      
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          messages: [
            {
              role: "user",
              content: `Based on this Wikipedia article, generate a quiz.

Article Title: ${wikiContent.title}
Description: ${wikiContent.description}
Content: ${wikiContent.extract.substring(0, 3000)}

Create 5-10 multiple choice questions based on this content. Return ONLY a JSON object (no markdown, no explanation) with this structure:

{
  "title": "${wikiContent.title}",
  "summary": "2-3 sentence summary",
  "key_entities": {
    "people": ["person1", "person2"],
    "organizations": ["org1"],
    "locations": ["location1"]
  },
  "sections": ["section1", "section2"],
  "quiz": [
    {
      "question": "Question text?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answer": "The correct option (must match exactly)",
      "difficulty": "easy",
      "explanation": "Why this is correct"
    }
  ],
  "related_topics": ["topic1", "topic2"]
}

Important: 
- Generate questions based ONLY on the content provided
- Answer must exactly match one option
- Mix easy, medium, and hard questions
- Return ONLY valid JSON`
            }
          ]
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API Error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message || 'API error occurred');
      }

      let textContent = data.content
        .filter(item => item.type === "text")
        .map(item => item.text)
        .join("\n");

      if (!textContent) {
        throw new Error('No content received from API');
      }

      textContent = textContent
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

      let jsonStart = textContent.indexOf('{');
      let jsonEnd = textContent.lastIndexOf('}');
      
      if (jsonStart !== -1 && jsonEnd !== -1) {
        textContent = textContent.substring(jsonStart, jsonEnd + 1);
      }

      let quizResult;
      try {
        quizResult = JSON.parse(textContent);
      } catch (parseError) {
        console.error('Parse error:', parseError);
        console.error('Content:', textContent);
        throw new Error('Failed to parse quiz data. Please try again.');
      }

      if (!quizResult.title || !quizResult.quiz || !Array.isArray(quizResult.quiz)) {
        throw new Error('Invalid quiz format received');
      }

      const quizWithId = {
        id: Date.now(),
        url: url,
        title: quizResult.title || wikiContent.title,
        summary: quizResult.summary || wikiContent.extract.substring(0, 200) + '...',
        key_entities: quizResult.key_entities || { people: [], organizations: [], locations: [] },
        sections: quizResult.sections || [],
        quiz: quizResult.quiz || [],
        related_topics: quizResult.related_topics || [],
        timestamp: new Date().toISOString()
      };

      setQuizData(quizWithId);
      setLoadingStatus('Saving quiz...');
      
      await window.storage.set(`quiz:${quizWithId.id}`, JSON.stringify(quizWithId));
      await loadHistory();
      
      setLoadingStatus('Complete!');
      
    } catch (err) {
      console.error('Quiz generation error:', err);
      setError(`${err.message}`);
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  };

  const viewQuizDetails = (quiz) => {
    setSelectedQuiz(quiz);
    setQuizData(quiz);
    setUserAnswers({});
    setShowResults(false);
  };

  const handleAnswerSelect = (questionIndex, answer) => {
    setUserAnswers({
      ...userAnswers,
      [questionIndex]: answer
    });
  };

  const submitQuiz = () => {
    setShowResults(true);
  };

  const calculateScore = () => {
    if (!quizData) return { correct: 0, total: 0, percentage: 0 };
    
    const correct = quizData.quiz.filter((q, idx) => 
      userAnswers[idx] === q.answer
    ).length;
    
    return {
      correct,
      total: quizData.quiz.length,
      percentage: Math.round((correct / quizData.quiz.length) * 100)
    };
  };

  const RobotAnimation = () => (
    <div className="robot-container">
      <div className={`robot-wrapper ${
        robotState === 'thinking' ? 'robot-thinking' : 
        robotState === 'celebrating' ? 'robot-celebrating' : ''
      }`}>
        <div className="robot-head">
          <div className="robot-antenna">
            <div className={`robot-bulb ${
              robotState === 'thinking' ? 'bulb-active' : ''
            }`}></div>
          </div>
          
          <div className="robot-eye robot-eye-left">
            <div className={`robot-pupil ${
              robotState === 'thinking' ? 'pupil-active' : ''
            }`}></div>
          </div>
          <div className="robot-eye robot-eye-right">
            <div className={`robot-pupil ${
              robotState === 'thinking' ? 'pupil-active' : ''
            }`}></div>
          </div>
          
          <div className={`robot-mouth ${
            robotState === 'celebrating' ? 'robot-mouth-happy' : ''
          }`}></div>
        </div>
        
        <div className="robot-body">
          <div className="robot-body-detail"></div>
        </div>
      </div>
      
      {robotState === 'celebrating' && (
        <>
          <Sparkles className="sparkle sparkle-1" />
          <Sparkles className="sparkle sparkle-2" />
          <Sparkles className="sparkle sparkle-3" />
          <Sparkles className="sparkle sparkle-4" />
        </>
      )}
      
      {loading && loadingStatus && (
        <div className="loading-status">
          <Loader2 className="status-spinner" />
          <p>{loadingStatus}</p>
        </div>
      )}
    </div>
  );

  const FloatingParticles = () => (
    <div className="floating-particles">
      {[...Array(20)].map((_, i) => (
        <div
          key={i}
          className="particle"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            animationDelay: `${Math.random() * 2}s`,
            animationDuration: `${2 + Math.random() * 3}s`
          }}
        />
      ))}
    </div>
  );

  return (
    <div className="app-container">
      <FloatingParticles />
      
      <div className="app-content">
        <div className="app-header">
          <div className="header-title">
            <h1 className="title-text">
              AI Wiki Quiz Generator
            </h1>
            <Brain className="title-icon" />
          </div>
          <p className="header-subtitle">Generate intelligent quizzes from Wikipedia articles powered by AI</p>
        </div>

        <div className="main-card">
          <div className="tab-bar">
            <button
              onClick={() => setActiveTab('generate')}
              className={`tab-button ${activeTab === 'generate' ? 'tab-active' : ''}`}
            >
              <BookOpen className="tab-icon" />
              Generate Quiz
              {activeTab === 'generate' && <div className="tab-indicator"></div>}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`tab-button ${activeTab === 'history' ? 'tab-active' : ''}`}
            >
              <History className="tab-icon" />
              Past Quizzes
              {activeTab === 'history' && <div className="tab-indicator"></div>}
            </button>
          </div>

          <div className="content-area">
            {activeTab === 'generate' && (
              <div>
                {(loading || quizData) && <RobotAnimation />}
                
                <div className="url-input-section">
                  <label className="input-label">
                    <Zap className="label-icon" />
                    Wikipedia Article URL
                  </label>
                  <div className="input-group">
                    <input
                      type="text"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://en.wikipedia.org/wiki/Alan_Turing"
                      className="url-input"
                      disabled={loading}
                      onKeyPress={(e) => e.key === 'Enter' && !loading && generateQuiz()}
                    />
                    <button
                      onClick={generateQuiz}
                      disabled={loading}
                      className="generate-button"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="button-icon spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="button-icon" />
                          Generate Quiz
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="error-message">
                    <AlertCircle className="error-icon" />
                    <div>
                      <p className="error-title">Error</p>
                      <p className="error-text">{error}</p>
                      <p className="error-hint">💡 Tip: Make sure you're using a valid Wikipedia URL like: https://en.wikipedia.org/wiki/Article_Name</p>
                    </div>
                  </div>
                )}

                {quizData && (
                  <div className="quiz-content fade-in">
                    <div className="quiz-header-card">
                      <h2 className="quiz-title">
                        <Award className="quiz-title-icon" />
                        {quizData.title}
                      </h2>
                      <p className="quiz-summary">{quizData.summary}</p>
                      
                      <div className="entities-grid">
                        {quizData.key_entities?.people?.length > 0 && (
                          <div className="entity-card">
                            <h4 className="entity-title">
                              <TrendingUp className="entity-icon" />
                              People
                            </h4>
                            <p className="entity-content">{quizData.key_entities.people.join(', ')}</p>
                          </div>
                        )}
                        {quizData.key_entities?.organizations?.length > 0 && (
                          <div className="entity-card">
                            <h4 className="entity-title">
                              <Brain className="entity-icon" />
                              Organizations
                            </h4>
                            <p className="entity-content">{quizData.key_entities.organizations.join(', ')}</p>
                          </div>
                        )}
                        {quizData.key_entities?.locations?.length > 0 && (
                          <div className="entity-card">
                            <h4 className="entity-title">
                              <Sparkles className="entity-icon" />
                              Locations
                            </h4>
                            <p className="entity-content">{quizData.key_entities.locations.join(', ')}</p>
                          </div>
                        )}
                      </div>

                      {quizData.sections?.length > 0 && (
                        <div className="sections-area">
                          <h4 className="sections-title">Article Sections</h4>
                          <div className="sections-tags">
                            {quizData.sections.map((section, idx) => (
                              <span key={idx} className="section-tag">
                                {section}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <h3 className="questions-header">
                        <Brain className="questions-icon pulse" />
                        Quiz Questions
                      </h3>
                      <div className="questions-container">
                        {quizData.quiz.map((q, idx) => (
                          <div key={idx} className="question-card slide-up" style={{animationDelay: `${idx * 0.1}s`}}>
                            <div className="question-header">
                              <h4 className="question-text">
                                <span className="question-number">
                                  {idx + 1}
                                </span>
                                <span className="question-content">{q.question}</span>
                              </h4>
                              <span className={`difficulty-badge difficulty-${q.difficulty}`}>
                                {q.difficulty}
                              </span>
                            </div>

                            <div className="options-container">
                              {q.options.map((option, optIdx) => (
                                <button
                                  key={optIdx}
                                  onClick={() => handleAnswerSelect(idx, option)}
                                  disabled={showResults}
                                  className={`option-button ${
                                    showResults
                                      ? option === q.answer
                                        ? 'option-correct'
                                        : userAnswers[idx] === option
                                        ? 'option-wrong'
                                        : 'option-neutral'
                                      : userAnswers[idx] === option
                                      ? 'option-selected'
                                      : 'option-default'
                                  }`}
                                >
                                  {showResults && option === q.answer && (
                                    <CheckCircle className="option-icon icon-correct bounce" />
                                  )}
                                  {showResults && userAnswers[idx] === option && option !== q.answer && (
                                    <XCircle className="option-icon icon-wrong pulse" />
                                  )}
                                  <span className="option-text">{option}</span>
                                </button>
                              ))}
                            </div>

                            {showResults && (
                              <div className="explanation-box">
                                <p className="explanation-text">
                                  <span className="explanation-label">💡 Explanation:</span> {q.explanation}
                                </p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {!showResults ? (
                      <button
                        onClick={submitQuiz}
                        className="submit-button"
                      >
                        <Award className="submit-icon" />
                        Submit Quiz
                      </button>
                    ) : (
                      <div className="results-card">
                        <div className="results-content">
                          <h3 className="results-title">
                            <Award className="results-award bounce" />
                            Quiz Results
                          </h3>
                          <div className="results-score">
                            {calculateScore().percentage}%
                          </div>
                          <p className="results-text">
                            {calculateScore().correct} out of {calculateScore().total} correct
                          </p>
                          {calculateScore().percentage === 100 && (
                            <div className="perfect-score bounce">
                              🎉 Perfect Score! You're a genius! 🎉
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {quizData.related_topics?.length > 0 && (
                      <div className="related-card">
                        <h4 className="related-title">
                          <Sparkles className="related-icon" />
                          Related Topics for Further Reading
                        </h4>
                        <div className="related-tags">
                          {quizData.related_topics.map((topic, idx) => (
                            <span key={idx} className="related-tag">
                              {topic}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <div>
                <h2 className="history-title">
                  <History className="history-icon" />
                  Quiz History
                </h2>
                {history.length === 0 ? (
                  <div className="empty-state">
                    <History className="empty-icon pulse" />
                    <p className="empty-title">No quizzes generated yet</p>
                    <p className="empty-subtitle">Start by generating your first quiz!</p>
                  </div>
                ) : (
                  <div className="history-list">
                    {history.map((quiz, idx) => (
                      <div key={quiz.id} className="history-card slide-up" style={{animationDelay: `${idx * 0.1}s`}}>
                        <div className="history-content">
                          <div className="history-details">
                            <h3 className="history-quiz-title">
                              <BookOpen className="history-quiz-icon" />
                              {quiz.title}
                            </h3>
                            <p className="history-summary">{quiz.summary}</p>
                            <div className="history-meta">
                              <span className="meta-badge">
                                <Brain className="meta-icon" />
                                {quiz.quiz.length} questions
                              </span>
                              <span className="meta-badge meta-date">
                                {new Date(quiz.timestamp).toLocaleDateString()}
                              </span>
                            </div>
                            <p className="history-url">{quiz.url}</p>
                          </div>
                          <button
                            onClick={() => {
                              viewQuizDetails(quiz);
                              setActiveTab('generate');
                            }}
                            className="view-button"
                          >
                            View Details
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        /* Animations */
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        @keyframes ping {
          75%, 100% {
            transform: scale(2);
            opacity: 0;
          }
        }

        /* Base Styles */
        .app-container {
          min-height: 100vh;
          background: linear-gradient(to bottom right, #312e81, #581c87, #9d174d);
          position: relative;
          overflow: hidden;
        }

        .floating-particles {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
        }

        .particle {
          position: absolute;
          width: 0.5rem;
          height: 0.5rem;
          background-color: rgba(192, 132, 252, 0.2);
          border-radius: 9999px;
          animation: pulse 2s ease-in-out infinite;
        }

        .app-content {
          position: relative;
          z-index: 10;
          max-width: 72rem;
          margin: 0 auto;
          padding: 2rem 1rem;
        }

        /* Header */
        .app-header {
          text-align: center;
          margin-bottom: 2rem;
        }

        .header-title {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .title-text {
          font-size: 3rem;
          font-weight: bold;
          color: white;
        }

        .title-icon {
          width: 3rem;
          height: 3rem;
          color: #facc15;
          animation: bounce 2s ease-in-out infinite;
        }

        .header-subtitle {
          font-size: 1.25rem;
          color: #e9d5ff;
        }

        /* Main Card */
        .main-card {
          background-color: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(12px);
          border-radius: 1.5rem;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.2);
          overflow: hidden;
        }

        /* Tabs */
        .tab-bar {
          display: flex;
          border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        }

        .tab-button {
          flex: 1;
          padding: 1rem 1.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          font-weight: 600;
          transition: all 0.2s;
          position: relative;
          background: transparent;
          border: none;
          cursor: pointer;
          color: #e9d5ff;
        }

        .tab-button:hover {
          background-color: rgba(255, 255, 255, 0.1);
        }

        .tab-active {
          color: white;
          background-color: rgba(255, 255, 255, 0.2);
        }

        .tab-icon {
          width: 1.25rem;
          height: 1.25rem;
        }

        .tab-indicator {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 0.25rem;
          background: linear-gradient(to right, #c084fc, #f0abfc);
        }

        /* Content Area */
        .content-area {
          padding: 2rem;
        }

        /* Robot Animation */
        .robot-container {
          position: relative;
          width: 8rem;
          height: 10rem;
          margin: 0 auto 1.5rem;
        }

        .robot-wrapper {
          position: absolute;
          inset: 0;
          transition: all 0.5s;
        }

        .robot-thinking {
          animation: bounce 1s ease-in-out infinite;
        }

        .robot-celebrating {
          animation: pulse 1s ease-in-out infinite;
        }

        .robot-head {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 5rem;
          height: 5rem;
          background: linear-gradient(to bottom right, #c084fc, #f0abfc);
          border-radius: 1rem;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        }

        .robot-antenna {
          position: absolute;
          top: -1rem;
          left: 50%;
          transform: translateX(-50%);
          width: 0.25rem;
          height: 1rem;
          background-color: #e9d5ff;
        }

        .robot-bulb {
          position: absolute;
          top: -0.5rem;
          left: 50%;
          transform: translateX(-50%);
          width: 0.75rem;
          height: 0.75rem;
          border-radius: 9999px;
          background-color: #c084fc;
        }

        .bulb-active {
          background-color: #facc15;
          animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
        }

        .robot-eye {
          position: absolute;
          top: 1.5rem;
          width: 1rem;
          height: 1rem;
          background-color: white;
          border-radius: 9999px;
        }

        .robot-eye-left {
          left: 0.75rem;
        }

        .robot-eye-right {
          right: 0.75rem;
        }

        .robot-pupil {
          position: absolute;
          inset: 0.25rem;
          background-color: #3b82f6;
          border-radius: 9999px;
        }

        .pupil-active {
          animation: pulse 1s ease-in-out infinite;
        }

        .robot-mouth {
          position: absolute;
          bottom: 0.75rem;
          left: 50%;
          transform: translateX(-50%);
          width: 2.5rem;
          height: 0.5rem;
          background-color: #374151;
          border-radius: 0.125rem;
        }

        .robot-mouth-happy {
          background-color: #4ade80;
          border-radius: 9999px;
        }

        .robot-body {
          position: absolute;
          top: 5rem;
          left: 50%;
          transform: translateX(-50%);
          width: 4rem;
          height: 3rem;
          background: linear-gradient(to bottom right, #a855f7, #ec4899);
          border-radius: 0.5rem;
        }

        .robot-body-detail {
          position: absolute;
          inset: 0.5rem;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 0.25rem;
        }

        .loading-status {
          position: absolute;
          bottom: -3rem;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: #e9d5ff;
          font-size: 0.875rem;
          white-space: nowrap;
        }

        .status-spinner {
          width: 1rem;
          height: 1rem;
          animation: spin 1s linear infinite;
        }

        .sparkle {
          position: absolute;
          width: 1.5rem;
          height: 1.5rem;
          animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
        }

        .sparkle-1 {
          top: 0;
          left: 0;
          color: #facc15;
        }

        .sparkle-2 {
          top: 0;
          right: 0;
          color: #f0abfc;
          animation-delay: 0.2s;
        }

        .sparkle-3 {
          bottom: 0;
          left: 1rem;
          color: #c084fc;
          animation-delay: 0.4s;
        }

        .sparkle-4 {
          bottom: 0;
          right: 1rem;
          color: #60a5fa;
          animation-delay: 0.6s;
        }

        /* URL Input Section */
        .url-input-section {
          margin-bottom: 2rem;
        }

        .input-label {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: white;
          font-weight: 600;
          margin-bottom: 0.75rem;
        }

        .label-icon {
          width: 1.25rem;
          height: 1.25rem;
          color: #facc15;
        }

        .input-group {
          display: flex;
          gap: 0.75rem;
        }

        .url-input {
          flex: 1;
          padding: 1rem 1.25rem;
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(236, 72, 153, 0.1));
          border: 2px solid rgba(168, 85, 247, 0.3);
          border-radius: 1rem;
          color: white;
          font-size: 1rem;
          outline: none;
          transition: all 0.3s ease;
          box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .url-input::placeholder {
          color: #d8b4fe;
        }

        .url-input:focus {
          border-color: #c084fc;
          box-shadow: 0 0 0 3px rgba(192, 132, 252, 0.2), inset 0 2px 4px rgba(0, 0, 0, 0.1);
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(236, 72, 153, 0.15));
        }

        .url-input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .generate-button {
          padding: 1rem 2rem;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 25%, #f093fb 50%, #4facfe 75%, #667eea 100%);
          background-size: 300% 300%;
          color: white;
          font-weight: bold;
          font-size: 1.1rem;
          border-radius: 1rem;
          border: none;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          box-shadow: 0 8px 25px rgba(168, 85, 247, 0.4), 0 0 20px rgba(236, 72, 153, 0.3);
          position: relative;
          overflow: hidden;
          animation: gradientShift 3s ease infinite;
        }

        .generate-button::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 0;
          height: 0;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.3);
          transform: translate(-50%, -50%);
          transition: width 0.6s, height 0.6s;
        }

        .generate-button:hover:not(:disabled)::before {
          width: 300px;
          height: 300px;
        }

        .generate-button:hover:not(:disabled) {
          transform: translateY(-3px) scale(1.05);
          box-shadow: 0 15px 35px rgba(168, 85, 247, 0.6), 0 0 30px rgba(236, 72, 153, 0.5);
        }

        .generate-button:active:not(:disabled) {
          transform: translateY(-1px) scale(1.02);
        }

        .generate-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          animation: none;
        }

        @keyframes gradientShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        .button-icon {
          width: 1.25rem;
          height: 1.25rem;
          position: relative;
          z-index: 1;
          filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.5));
        }

        @keyframes iconPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.2); }
        }

        .generate-button:hover .button-icon:not(.spin) {
          animation: iconPulse 0.6s ease-in-out infinite;
        }

        /* Error Message */
        .error-message {
          margin-bottom: 1.5rem;
          padding: 1.25rem;
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(220, 38, 38, 0.15));
          border: 2px solid rgba(248, 113, 113, 0.5);
          border-radius: 1rem;
          display: flex;
          align-items: flex-start;
          gap: 1rem;
          backdrop-filter: blur(8px);
        }

        .error-icon {
          width: 1.5rem;
          height: 1.5rem;
          color: #fca5a5;
          flex-shrink: 0;
          margin-top: 0.125rem;
        }

        .error-title {
          color: #fecaca;
          font-weight: bold;
          font-size: 1.125rem;
          margin: 0 0 0.5rem 0;
        }

        .error-text {
          color: #fecaca;
          margin: 0 0 0.5rem 0;
        }

        .error-hint {
          color: #fcd34d;
          font-size: 0.875rem;
          margin: 0;
        }

        /* Quiz Content */
        .quiz-content {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .fade-in {
          animation: fadeIn 0.5s ease-out;
        }

        .quiz-header-card {
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(236, 72, 153, 0.2));
          backdrop-filter: blur(12px);
          border-radius: 1.5rem;
          padding: 2rem;
          border: 2px solid rgba(192, 132, 252, 0.3);
          box-shadow: 0 10px 40px rgba(168, 85, 247, 0.3);
          position: relative;
          overflow: hidden;
        }

        .quiz-header-card::before {
          content: '';
          position: absolute;
          top: -50%;
          right: -50%;
          width: 200%;
          height: 200%;
          background: radial-gradient(circle, rgba(236, 72, 153, 0.1) 0%, transparent 70%);
          animation: rotateGlow 10s linear infinite;
        }

        @keyframes rotateGlow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .quiz-title {
          font-size: 1.875rem;
          font-weight: bold;
          color: white;
          margin-bottom: 1rem;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          position: relative;
          z-index: 1;
        }

        .quiz-title-icon {
          width: 2rem;
          height: 2rem;
          color: #facc15;
        }

        .quiz-summary {
          color: #e9d5ff;
          font-size: 1.125rem;
          margin-bottom: 1.5rem;
          position: relative;
          z-index: 1;
        }

        .entities-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
          margin-bottom: 1.5rem;
          position: relative;
          z-index: 1;
        }

        .entity-card {
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(236, 72, 153, 0.1));
          border-radius: 1rem;
          padding: 1.25rem;
          border: 2px solid rgba(192, 132, 252, 0.2);
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }

        .entity-card::before {
          content: '';
          position: absolute;
          top: -2px;
          left: -100%;
          width: 100%;
          height: 2px;
          background: linear-gradient(90deg, transparent, #c084fc, transparent);
          transition: left 0.5s ease;
        }

        .entity-card:hover {
          transform: translateY(-3px);
          border-color: rgba(192, 132, 252, 0.4);
          box-shadow: 0 8px 20px rgba(168, 85, 247, 0.3);
        }

        .entity-card:hover::before {
          left: 100%;
        }

        .entity-title {
          color: white;
          font-weight: 600;
          margin-bottom: 0.5rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .entity-icon {
          width: 1rem;
          height: 1rem;
        }

        .entity-content {
          color: #e9d5ff;
          font-size: 0.875rem;
          margin: 0;
        }

        .sections-area {
          margin-top: 1rem;
          position: relative;
          z-index: 1;
        }

        .sections-title {
          color: white;
          font-weight: 600;
          margin-bottom: 0.75rem;
        }

        .sections-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .section-tag {
          padding: 0.25rem 0.75rem;
          background-color: rgba(168, 85, 247, 0.3);
          color: #e9d5ff;
          border-radius: 9999px;
          font-size: 0.875rem;
        }

        /* Questions */
        .questions-header {
          font-size: 1.5rem;
          font-weight: bold;
          color: white;
          margin-bottom: 1.5rem;
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .questions-icon {
          width: 1.75rem;
          height: 1.75rem;
          color: #c084fc;
        }

        .questions-container {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .question-card {
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(168, 85, 247, 0.05));
          backdrop-filter: blur(12px);
          border-radius: 1.5rem;
          padding: 2rem;
          border: 2px solid rgba(192, 132, 252, 0.2);
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }

        .question-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
          transition: left 0.5s ease;
        }

        .question-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 15px 40px rgba(168, 85, 247, 0.3);
          border-color: rgba(192, 132, 252, 0.4);
        }

        .question-card:hover::before {
          left: 100%;
        }

        .slide-up {
          animation: slideUp 0.5s ease-out forwards;
          opacity: 0;
        }

        .question-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 1rem;
        }

        .question-text {
          font-size: 1.25rem;
          font-weight: 600;
          color: white;
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          flex: 1;
          margin: 0;
        }

        .question-number {
          flex-shrink: 0;
          width: 2rem;
          height: 2rem;
          background: linear-gradient(to bottom right, #a855f7, #ec4899);
          border-radius: 9999px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.875rem;
          font-weight: bold;
        }

        .question-content {
          flex: 1;
        }

        .difficulty-badge {
          padding: 0.25rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: bold;
        }

        .difficulty-easy {
          background-color: rgba(34, 197, 94, 0.3);
          color: #bbf7d0;
        }

        .difficulty-medium {
          background-color: rgba(234, 179, 8, 0.3);
          color: #fef08a;
        }

        .difficulty-hard {
          background-color: rgba(239, 68, 68, 0.3);
          color: #fecaca;
        }

        .options-container {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .option-button {
          width: 100%;
          padding: 1.25rem;
          border-radius: 1rem;
          text-align: left;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          cursor: pointer;
          position: relative;
          overflow: hidden;
        }

        .option-button::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          height: 100%;
          width: 0;
          background: linear-gradient(90deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2));
          transition: width 0.4s ease;
          z-index: 0;
        }

        .option-button:hover:not(:disabled)::before {
          width: 100%;
        }

        .option-default {
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(168, 85, 247, 0.05));
          border: 2px solid rgba(168, 85, 247, 0.2);
          color: #e9d5ff;
        }

        .option-default:hover {
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(168, 85, 247, 0.1));
          border-color: rgba(168, 85, 247, 0.4);
          transform: translateX(8px);
          box-shadow: 0 5px 15px rgba(168, 85, 247, 0.2);
        }

        .option-selected {
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.5), rgba(236, 72, 153, 0.4));
          border: 2px solid #c084fc;
          color: white;
          transform: scale(1.02);
          box-shadow: 0 8px 20px rgba(168, 85, 247, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.2);
        }

        .option-correct {
          background: linear-gradient(135deg, rgba(34, 197, 94, 0.4), rgba(16, 185, 129, 0.4));
          border: 2px solid #4ade80;
          color: white;
          box-shadow: 0 8px 20px rgba(34, 197, 94, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.2);
          animation: correctPulse 0.5s ease;
        }

        .option-wrong {
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.4), rgba(220, 38, 38, 0.4));
          border: 2px solid #f87171;
          color: white;
          box-shadow: 0 8px 20px rgba(239, 68, 68, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.2);
          animation: wrongShake 0.5s ease;
        }

        .option-neutral {
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(100, 100, 100, 0.05));
          border: 2px solid rgba(255, 255, 255, 0.15);
          color: #cbd5e1;
        }

        @keyframes correctPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }

        @keyframes wrongShake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-10px); }
          75% { transform: translateX(10px); }
        }

        .option-button:disabled {
          cursor: default;
        }

        .option-icon {
          width: 1.25rem;
          height: 1.25rem;
          flex-shrink: 0;
          position: relative;
          z-index: 1;
        }

        .icon-correct {
          color: #86efac;
        }

        .icon-wrong {
          color: #fca5a5;
        }

        .option-text {
          flex: 1;
          position: relative;
          z-index: 1;
        }

        .explanation-box {
          margin-top: 1rem;
          padding: 1rem;
          background-color: rgba(59, 130, 246, 0.2);
          border: 1px solid rgba(96, 165, 250, 0.3);
          border-radius: 0.75rem;
        }

        .explanation-text {
          color: #bfdbfe;
          margin: 0;
        }

        .explanation-label {
          font-weight: bold;
        }

        /* Submit Button */
        .submit-button {
          width: 100%;
          padding: 1.25rem;
          background: linear-gradient(135deg, #10b981 0%, #059669 25%, #34d399 50%, #10b981 75%, #059669 100%);
          background-size: 300% 300%;
          color: white;
          font-weight: bold;
          border-radius: 1rem;
          border: none;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          font-size: 1.25rem;
          box-shadow: 0 10px 30px rgba(16, 185, 129, 0.4), 0 0 20px rgba(52, 211, 153, 0.3);
          position: relative;
          overflow: hidden;
          animation: gradientShift 3s ease infinite;
        }

        .submit-button::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 0;
          height: 0;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.3);
          transform: translate(-50%, -50%);
          transition: width 0.6s, height 0.6s;
        }

        .submit-button:hover::before {
          width: 400px;
          height: 400px;
        }

        .submit-button:hover {
          transform: translateY(-3px) scale(1.02);
          box-shadow: 0 15px 40px rgba(16, 185, 129, 0.6), 0 0 30px rgba(52, 211, 153, 0.5);
        }

        .submit-icon {
          width: 1.5rem;
          height: 1.5rem;
          position: relative;
          z-index: 1;
          filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.5));
        }

        .submit-button:hover .submit-icon {
          animation: iconPulse 0.6s ease-in-out infinite;
        }

        /* Results Card */
        .results-card {
          position: relative;
          background: linear-gradient(to bottom right, rgba(234, 179, 8, 0.2), rgba(249, 115, 22, 0.2));
          backdrop-filter: blur(8px);
          border-radius: 1rem;
          padding: 2rem;
          border: 2px solid rgba(250, 204, 21, 0.5);
          overflow: hidden;
        }

        .results-card::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(to right, rgba(250, 204, 21, 0.1), rgba(251, 146, 60, 0.1));
          animation: pulse 2s ease-in-out infinite;
        }

        .results-content {
          position: relative;
          z-index: 10;
          text-align: center;
        }

        .results-title {
          font-size: 1.875rem;
          font-weight: bold;
          color: white;
          margin-bottom: 1rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
        }

        .results-award {
          width: 2.5rem;
          height: 2.5rem;
          color: #facc15;
        }

        .results-score {
          font-size: 4.5rem;
          font-weight: bold;
          color: #fde047;
          margin-bottom: 0.5rem;
        }

        .results-text {
          font-size: 1.5rem;
          color: white;
          margin-bottom: 1rem;
        }

        .perfect-score {
          font-size: 1.5rem;
          font-weight: bold;
          color: #fde047;
        }

        /* Related Topics */
        .related-card {
          background-color: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(8px);
          border-radius: 1rem;
          padding: 1.5rem;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .related-title {
          font-size: 1.25rem;
          font-weight: bold;
          color: white;
          margin-bottom: 1rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .related-icon {
          width: 1.25rem;
          height: 1.25rem;
          color: #facc15;
        }

        .related-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .related-tag {
          padding: 0.5rem 1rem;
          background: linear-gradient(to right, rgba(168, 85, 247, 0.3), rgba(236, 72, 153, 0.3));
          color: white;
          border-radius: 9999px;
          font-size: 0.875rem;
          font-weight: 500;
        }

        /* History Tab */
        .history-title {
          font-size: 1.875rem;
          font-weight: bold;
          color: white;
          margin-bottom: 1.5rem;
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .history-icon {
          width: 1.75rem;
          height: 1.75rem;
          color: #c084fc;
        }

        .empty-state {
          text-align: center;
          padding: 4rem 0;
        }

        .empty-icon {
          width: 4rem;
          height: 4rem;
          color: #e9d5ff;
          margin: 0 auto 1rem;
        }

        .empty-title {
          font-size: 1.5rem;
          color: white;
          margin-bottom: 0.5rem;
        }

        .empty-subtitle {
          color: #e9d5ff;
          margin: 0;
        }

        .history-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .history-card {
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(168, 85, 247, 0.08));
          backdrop-filter: blur(12px);
          border-radius: 1.25rem;
          padding: 1.75rem;
          border: 2px solid rgba(168, 85, 247, 0.2);
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }

        .history-card::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          width: 0;
          height: 3px;
          background: linear-gradient(90deg, #a855f7, #ec4899);
          transition: width 0.4s ease;
        }

        .history-card:hover {
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(168, 85, 247, 0.12));
          transform: translateX(5px);
          border-color: rgba(192, 132, 252, 0.4);
          box-shadow: 0 10px 30px rgba(168, 85, 247, 0.3);
        }

        .history-card:hover::after {
          width: 100%;
        }

        .history-content {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
        }

        .history-details {
          flex: 1;
        }

        .history-quiz-title {
          font-size: 1.25rem;
          font-weight: bold;
          color: white;
          margin-bottom: 0.5rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .history-quiz-icon {
          width: 1.25rem;
          height: 1.25rem;
          color: #c084fc;
        }

        .history-summary {
          color: #e9d5ff;
          margin-bottom: 0.75rem;
        }

        .history-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }

        .meta-badge {
          padding: 0.25rem 0.75rem;
          background-color: rgba(168, 85, 247, 0.3);
          color: #e9d5ff;
          border-radius: 9999px;
          font-size: 0.875rem;
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        .meta-date {
          background-color: rgba(236, 72, 153, 0.3);
          color: #fbcfe8;
        }

        .meta-icon {
          width: 0.75rem;
          height: 0.75rem;
        }

        .history-url {
          color: #d8b4fe;
          font-size: 0.875rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin: 0;
        }

        .view-button {
          padding: 0.75rem 1.75rem;
          background: linear-gradient(135deg, #a855f7 0%, #ec4899 50%, #f472b6 100%);
          background-size: 200% 200%;
          color: white;
          font-weight: 600;
          border-radius: 0.75rem;
          border: none;
          cursor: pointer;
          transition: all 0.3s ease;
          flex-shrink: 0;
          box-shadow: 0 4px 15px rgba(168, 85, 247, 0.4);
          position: relative;
          overflow: hidden;
          animation: gradientShift 2s ease infinite;
        }

        .view-button::after {
          content: '→';
          position: absolute;
          right: 1rem;
          opacity: 0;
          transition: all 0.3s ease;
        }

        .view-button:hover {
          background-position: 100% 0;
          transform: translateX(5px) scale(1.05);
          box-shadow: 0 6px 20px rgba(168, 85, 247, 0.6);
          padding-right: 2.5rem;
        }

        .view-button:hover::after {
          opacity: 1;
          right: 0.75rem;
        }

        /* Responsive */
        @media (max-width: 768px) {
          .title-text {
            font-size: 2rem;
          }

          .title-icon {
            width: 2rem;
            height: 2rem;
          }

          .header-subtitle {
            font-size: 1rem;
          }

          .input-group {
            flex-direction: column;
          }

          .quiz-title {
            font-size: 1.5rem;
          }

          .entities-grid {
            grid-template-columns: 1fr;
          }

          .question-text {
            font-size: 1rem;
          }

          .results-score {
            font-size: 3rem;
          }

          .history-content {
            flex-direction: column;
          }

          .view-button {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
};

export default App;