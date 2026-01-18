
export class GroqService {
    constructor() {
        this.apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
        this.model = 'llama-3.1-8b-instant';
    }

    getApiKey() {
        let key = import.meta.env.VITE_GROQ_API_KEY || localStorage.getItem('groq_api_key');
        if (!key) {
            key = prompt('Enter your Groq API Key to enable Smart Shuffle recommendations:');
            if (key) {
                localStorage.setItem('groq_api_key', key);
            }
        }
        return key;
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
