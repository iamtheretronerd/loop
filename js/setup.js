import { apiSettings } from './storage.js';

export async function checkRequiredConfig() {
    const api = await apiSettings.getInstances('api');
    const streaming = await apiSettings.getInstances('streaming');

    if (api.length === 0 && streaming.length === 0) {
        showSetupModal();
        return false;
    }
    return true;
}

function showSetupModal() {
    const style = document.createElement('style');
    style.textContent = `
        .setup-modal {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.95); z-index: 99999;
            display: flex; justify-content: center; align-items: center; color: white;
            font-family: system-ui, -apple-system, sans-serif;
        }
        .setup-container {
            background: #111; padding: 2rem; border-radius: 12px; border: 1px solid #333;
            width: 500px; max-width: 90%; max-height: 90vh; overflow-y: auto;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .setup-h2 { margin-top: 0; margin-bottom: 0.5rem; font-size: 1.5rem; color: white; }
        .setup-section { margin-bottom: 1.5rem; }
        .setup-label { display: block; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.9rem; color: #ddd; }
        .setup-textarea { 
            width: 100%; height: 100px; background: #000; border: 1px solid #333; 
            color: #eee; padding: 0.8rem; border-radius: 6px; font-family: monospace; font-size: 0.85rem;
            resize: vertical;
        }
        .setup-textarea:focus { outline: none; border-color: #666; }
        .setup-btn { 
            background: white; color: black; padding: 0.8rem 1.5rem; border: none; 
            font-weight: bold; cursor: pointer; width: 100%; border-radius: 6px;
            font-size: 1rem; transition: opacity 0.2s;
        }
        .setup-btn:hover { opacity: 0.9; }
        .setup-file-wrapper {
            border: 1px dashed #444; padding: 1rem; border-radius: 6px; text-align: center;
            background: #0a0a0a; cursor: pointer; position: relative;
        }
        .setup-file-wrapper:hover { border-color: #666; }
        .setup-file { opacity: 0; position: absolute; top:0; left:0; width:100%; height:100%; cursor: pointer; }
        .setup-error { 
            background: rgba(255, 0, 0, 0.1); border: 1px solid rgba(255, 0, 0, 0.3); 
            color: #ff6b6b; padding: 0.8rem; border-radius: 6px; margin-bottom: 1rem; 
            display: none; font-size: 0.9rem;
        }
    `;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.className = 'setup-modal';
    modal.innerHTML = `
        <div class="setup-container">
            <h2 class="setup-h2">Welcome to Loop</h2>
            <p style="margin-bottom:1.5rem; color:#888; font-size: 0.9rem; line-height: 1.5;">
                Please configure your Music API instances to get started. 
                You can import from a CSV or enter URLs manually.
            </p>
            
            <div class="setup-error" id="setup-error"></div>

            <div class="setup-section">
                <label class="setup-label">Import from CSV</label>
                <div class="setup-file-wrapper">
                    <span id="file-label" style="color:#888; pointer-events:none;">Click to upload import.csv</span>
                    <input type="file" id="setup-file" accept=".csv" class="setup-file">
                </div>
                <p style="font-size:0.75rem; color:#555; margin-top:0.5rem;">
                    Required columns: <code>api</code>, <code>streaming</code> (URLs)
                </p>
            </div>

            <div class="setup-section">
                <label class="setup-label">API Instances (One URL per line)</label>
                <textarea id="setup-api" class="setup-textarea" placeholder="https://api.example.com"></textarea>
            </div>

            <div class="setup-section">
                <label class="setup-label">Streaming Instances (One URL per line)</label>
                <textarea id="setup-stream" class="setup-textarea" placeholder="https://stream.example.com"></textarea>
            </div>

            <button id="setup-save" class="setup-btn">Save & Start</button>
        </div>
    `;
    document.body.appendChild(modal);

    const fileInput = document.getElementById('setup-file');
    const apiInput = document.getElementById('setup-api');
    const streamInput = document.getElementById('setup-stream');
    const saveBtn = document.getElementById('setup-save');
    const errorDiv = document.getElementById('setup-error');
    const fileLabel = document.getElementById('file-label');

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        fileLabel.textContent = file.name;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const text = event.target.result;
                const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
                
                if (lines.length === 0) throw new Error('Empty file');

                const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
                
                const apiIdx = headers.indexOf('api');
                const streamIdx = headers.indexOf('streaming');
                
                if (apiIdx === -1 && streamIdx === -1) {
                    throw new Error('CSV must have "api" or "streaming" columns');
                }
                
                const apis = [];
                const streams = [];
                
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i];
                    // Basic CSV split (assumes no commas in URLs)
                    const cols = line.split(',').map(c => c.trim());
                    
                    if (apiIdx !== -1 && cols[apiIdx]) apis.push(cols[apiIdx]);
                    if (streamIdx !== -1 && cols[streamIdx]) streams.push(cols[streamIdx]);
                }
                
                if (apis.length) apiInput.value = apis.join('\n');
                if (streams.length) streamInput.value = streams.join('\n');
                
                errorDiv.style.display = 'none';
            } catch (err) {
                errorDiv.textContent = 'CSV Error: ' + err.message;
                errorDiv.style.display = 'block';
            }
        };
        reader.readAsText(file);
    });

    saveBtn.addEventListener('click', () => {
        const apis = apiInput.value.split('\n').map(s => s.trim()).filter(s => s);
        const streams = streamInput.value.split('\n').map(s => s.trim()).filter(s => s);

        if (apis.length === 0 && streams.length === 0) {
            errorDiv.textContent = 'Please configure at least one instance.';
            errorDiv.style.display = 'block';
            return;
        }

        apiSettings.saveInstances(apis, 'api');
        apiSettings.saveInstances(streams, 'streaming');

        window.location.reload();
    });
}
