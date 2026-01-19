
export class GroqService {
    constructor() {
        this.apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
        this.model = 'llama-3.1-8b-instant';
    }

    isValidApiKey(key) {
        // Check if key exists and is not a placeholder value
        if (!key) return false;
        const placeholders = ['your_groq_api_key', 'your_api_key', 'api_key_here', 'xxx', ''];
        if (placeholders.some(p => key.toLowerCase().includes(p))) return false;
        // Groq API keys typically start with 'gsk_' and are reasonably long
        if (key.length < 20) return false;
        return true;
    }

    getApiKey() {
        let key = import.meta.env.VITE_GROQ_API_KEY;

        // Check if env key is valid, otherwise try localStorage
        if (!this.isValidApiKey(key)) {
            key = localStorage.getItem('groq_api_key');
        }

        // If still no valid key, prompt user
        if (!this.isValidApiKey(key)) {
            key = prompt('Enter your Groq API Key to enable Smart Shuffle recommendations:\n\nGet your free API key at: https://console.groq.com/keys');
            if (key && this.isValidApiKey(key)) {
                localStorage.setItem('groq_api_key', key);
            } else if (key) {
                // User entered something but it looks invalid
                alert('The API key you entered appears to be invalid. Please check and try again.');
                return null;
            }
        }
        return key;
    }

    clearApiKey() {
        localStorage.removeItem('groq_api_key');
    }

    async getRecommendations(lastPlayed, currentContext, count = 5) {
        const apiKey = this.getApiKey();
        if (!apiKey) throw new Error('No API Key provided');

        const lastPlayedStr = lastPlayed.map(t => `- ${t.title} by ${t.artist}`).join('\n');
        const contextStr = currentContext.slice(0, 20).map(t => `- ${t.title} by ${t.artist}`).join('\n');

        const prompt = `
You are a smart music recommendation engine.

Last Played Songs (User Preference):
${lastPlayedStr}

Current Playlist Context:
${contextStr}

Task: Recommend ${count} songs that fit perfectly in between the playlist tracks, bridging the style of the last played songs with the current playlist. These should be high-quality recommendations.

Output Format: A strictly valid JSON array of objects, each containing "title" and "artist". Do not include any explanation or markdown formatting.
Example: [{"title": "Song", "artist": "Artist"}]
`;

        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: 'system', content: 'You are a music recommendation assistant. Output valid JSON only.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 1024
                })
            });

            if (!response.ok) {
                const err = await response.text();
                // Clear stored key on authentication errors so user can re-enter
                if (response.status === 401 || response.status === 403) {
                    this.clearApiKey();
                    throw new Error('Invalid API key. Please try again with a valid Groq API key.');
                }
                throw new Error(`Groq API Error: ${response.status} - ${err}`);
            }

            const data = await response.json();
            const content = data.choices[0].message.content;
            
            // Clean markdown if present
            const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
            const recommendations = JSON.parse(jsonStr);
            
            if (Array.isArray(recommendations)) {
                return recommendations;
            }
            return [];
        } catch (error) {
            console.error('Groq Service Error:', error);
            throw error;
        }
    }
}
