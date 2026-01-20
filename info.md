# Loop Music API Instances

This guide explains how Loop Music manages API instances for decentralized music streaming.

## 🔄 API Instance Architecture

Loop Music uses a multi-instance system where users can add multiple API endpoints that the app will automatically manage and switch between for redundancy and performance.

### Instance Types

#### API Instances

- **Purpose**: Handle metadata requests (search, track info, album/artist data)
- **Test Endpoint**: `/artist/?id=3532302` (uses Daft Punk as test case)
- **Caching**: 1 hour speed test cache
- **Function**: Provides track metadata, search results, album/artist information

#### Streaming Instances

- **Purpose**: Handle actual audio stream requests
- **Test Endpoint**: `/track/?id=204567804&quality=HIGH`
- **Function**: Provides audio streams and DASH manifests
- **Separation**: Can be different from API instances for load distribution

### Instance Management

#### Automatic Discovery

- Instances are loaded from user configuration or `instances.json`
- No default instances - requires manual setup for security
- Speed testing determines instance priority

#### Speed Testing

```javascript
// Tests instance response times
const results = await speedTestInstance(url, type);
// Results cached for 1 hour in localStorage
```

#### Failover System

- Automatic switching between instances on failure
- Retry logic with exponential backoff (3 attempts)
- Rate limit handling (HTTP 429 responses)

#### Instance Ordering

- Instances sorted by response speed
- Faster instances prioritized
- Speed cache updated every hour

## 🎯 Instance Configuration

### Adding Instances to Loop Music

#### Manual Configuration

In Loop Music settings, users can add custom API instances:

```javascript
// localStorage key: 'loop-api-instances-v2'
{
  "api": [
    "https://api1.your-server.com",
    "https://api2.your-server.com"
  ],
  "streaming": [
    "https://stream1.your-server.com",
    "https://stream2.your-server.com"
  ]
}
```

#### Instance Requirements

##### API Instance Endpoints

Your API server must provide these endpoints:

```
GET /search/?s={query}
```

- Returns search results for tracks, albums, artists
- Response format matches Loop Music expectations

```
GET /track/?id={trackId}&quality={quality}
```

- Returns track metadata only (no streaming)
- Quality options: LOSSLESS, HIGH, MEDIUM, LOW

```
GET /album/?id={albumId}
```

- Returns album metadata with track list

```
GET /artist/?id={artistId}
```

- Returns artist metadata and discography

##### Streaming Instance Endpoints

```
GET /track/?id={trackId}&quality={quality}
```

- Returns track metadata + streaming manifest
- Must support DASH streaming format

### Instance Health Monitoring

#### Automatic Testing

- Speed tests run on instance addition
- Failed instances marked with error status
- Health checks every instance switch

#### Error Handling

```javascript
// Rate limit detection
if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    await delay(retryAfter * 1000);
    continue;
}
```

## 🚀 Hosting Your Own Instance

### Basic Requirements

#### Server Hardware

- **CPU**: 1+ cores
- **RAM**: 2GB minimum
- **Storage**: Enough for your music library
- **Network**: 10Mbps+ upload for streaming

#### Server Software

- **Web Server**: Any HTTP server (Node.js, Python, PHP, etc.)
- **Database**: SQLite/PostgreSQL/MySQL for metadata
- **Audio Tools**: FFmpeg for transcoding (if needed)

### Instance Setup Steps

1. **Choose Your Tech Stack**
    - Node.js + Express (recommended)
    - Python + Flask/FastAPI
    - PHP + Laravel
    - Any HTTP server framework

2. **Implement Required Endpoints**
    - Search endpoint returning Loop-compatible format
    - Metadata endpoints for tracks/albums/artists
    - Streaming endpoint with DASH manifest

3. **Set Up Music Library**
    - Organize audio files in accessible directory
    - Extract metadata using tools like `ffprobe`
    - Store metadata in database

4. **Configure CORS**

    ```javascript
    // Allow Loop Music to access your instance
    app.use(
        cors({
            origin: true, // Allow any origin for maximum compatibility
            credentials: true,
        })
    );
    ```

5. **Test Instance**

    ```bash
    # Test API endpoint
    curl "https://your-instance.com/artist/?id=3532302"

    # Test streaming endpoint
    curl "https://your-instance.com/track/?id=1&quality=HIGH"
    ```

6. **Add to Loop Music**
    - Open Loop Music settings
    - Add your instance URLs
    - Test connection and speed

### Instance Optimization

#### Performance Tips

- Implement response caching (Redis/memory)
- Use CDNs for static audio files
- Enable gzip compression
- Set appropriate cache headers

#### Security Considerations

- Rate limiting to prevent abuse
- Input validation on all endpoints
- HTTPS required for production
- Consider API keys for private instances

### Instance Scaling

#### Multiple Instances

- Run API and streaming on separate servers
- Use load balancers for high traffic
- Geographic distribution with CDNs

#### Database Optimization

- Index frequently searched columns
- Use connection pooling
- Implement query result caching

## 📊 Instance Statistics

### Performance Metrics

- **Response Time**: Average API response time
- **Uptime**: Instance availability percentage
- **Error Rate**: Failed request percentage
- **Cache Hit Rate**: Metadata cache effectiveness

### Monitoring Your Instance

```javascript
// Basic health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
    });
});
```

## 🔧 Troubleshooting

### Common Issues

#### Instance Not Connecting

- Check CORS headers
- Verify HTTPS certificate
- Test endpoints manually with curl

#### Slow Performance

- Enable caching
- Check database query performance
- Monitor server resources

#### Streaming Issues

- Verify DASH manifest format
- Check FFmpeg installation
- Test audio file accessibility

### Instance Validation

#### Required Response Formats

All endpoints must return data in Loop Music's expected format. Test with:

```javascript
// Search response format
{
  tracks: { items: [...], limit: 50, offset: 0, totalNumberOfItems: 100 },
  albums: { items: [...], limit: 20, offset: 0, totalNumberOfItems: 50 },
  artists: { items: [...], limit: 20, offset: 0, totalNumberOfItems: 25 }
}
```

## 🌐 Instance Ecosystem

### Public Instances

- Community-maintained public API instances
- Decentralized music streaming network
- No single point of failure

### Private Instances

- Personal music libraries
- Family/shared collections
- Institutional archives

### Commercial Instances

- Premium music services
- Licensed content providers
- Enterprise deployments

---

**Loop Music instances create a decentralized, resilient music streaming network!** 🎵
