
const API_URL = '/api/stats';

export async function fetchStats() {
    const res = await fetch(API_URL);
    return await res.json();
}

export async function startAnalysis(url) {
    const res = await fetch('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ url, depth: 5 })
    });
    return await res.json();
}

export async function stopAnalysis() {
    await fetch('/api/stop', { method: 'POST' });
}

export async function setTagApi(url, status) {
    await fetch('/api/tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, status })
    });
}
