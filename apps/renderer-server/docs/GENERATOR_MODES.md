# Generator Loading Modes

The renderer-server supports two modes for loading generator configurations:

## 🔄 Dynamic Mode (Recommended)

**Default behavior when `GENERATOR_CONFIG_PATH` is not set**

Generators are loaded on-demand from API requests. Each request includes the full generator data in the payload.

### Advantages
✅ No pre-configuration needed
✅ Works with any product dynamically
✅ Always uses latest generator data
✅ Perfect for frontend-driven workflows
✅ Ideal for development and testing

### How it Works

1. Server starts with 0 generators
2. Frontend fetches product + generator data from API
3. Frontend sends render request with `generatorData` field:

```json
{
  "generatorId": "gen_xxx",
  "generatorData": {
    "id": "gen_xxx",
    "views": [...],
    "colors": [...],
    "regions": [...]
  },
  "images": [...],
  "colors": ["Black"],
  "views": ["view-0"]
}
```

4. Server loads generator on first request
5. Generator is cached for future requests with same ID

### Startup Output
```
ℹ️  Running in DYNAMIC mode - generators will be loaded from API requests
📦 Starting with 0 generators (DYNAMIC mode - generators loaded on-demand)
✅ Renderer initialized successfully
```

## 📋 Static Mode

**Enabled by setting `GENERATOR_CONFIG_PATH` environment variable**

Generators are pre-loaded from a JSON file on server startup.

### Advantages
✅ Faster first request (no generator loading)
✅ Consistent generator versions
✅ Works without sending generatorData in every request
✅ Good for batch processing pipelines

### How it Works

1. Create a generators JSON file:

```json
[
  {
    "id": "gen_xxx",
    "active": true,
    "printMethod": "SUBLIMATION",
    "views": [...],
    "colors": [...],
    "regions": [...]
  }
]
```

2. Set environment variable:

```bash
export GENERATOR_CONFIG_PATH=/path/to/generators.json
```

or in Docker:

```dockerfile
ENV GENERATOR_CONFIG_PATH=/app/config/generators.json
```

3. Server loads generators on startup
4. Requests only need `generatorId`:

```json
{
  "generatorId": "gen_xxx",
  "images": [...],
  "colors": ["Black"],
  "views": ["view-0"]
}
```

### Startup Output
```
📂 Loading generator config from: /app/config/generators.json
📦 Loaded 5 generator configurations (STATIC mode)
✅ Renderer initialized successfully
```

## 🔀 Hybrid Mode

You can use both modes simultaneously!

- Pre-load common generators from config file
- Still accept `generatorData` in requests for new products
- Best of both worlds: fast for common products, flexible for new ones

## Which Mode to Use?

### Use Dynamic Mode When:
- Building a frontend application (like your AnalyticsDashboard)
- Working with products from Fourthwall API
- Developing and testing
- Generators change frequently
- You want flexibility

### Use Static Mode When:
- Running automated batch processing
- Generators are stable and versioned
- Want maximum performance
- Running in a controlled environment
- Processing large volumes of the same products

### Use Hybrid Mode When:
- Running in production with both common and custom products
- Want fast performance for popular products
- Still need flexibility for new products

## Migration Path

### From Static to Dynamic
1. Remove `GENERATOR_CONFIG_PATH` from environment
2. Add `generatorData` to API requests
3. Server will switch to dynamic mode automatically

### From Dynamic to Static
1. Export generator data to JSON file
2. Set `GENERATOR_CONFIG_PATH` environment variable
3. Remove `generatorData` from API requests (optional)
4. Server will use pre-loaded generators

## Troubleshooting

### "Renderer not initialized"
**Problem:** Server failed to initialize
**Solution:** Check logs for initialization errors, ensure gl context created successfully

### "Generator not found"
**Problem:** Using generatorId without pre-loading or sending generatorData
**Solution:** Either:
- Add generator to static config file, OR
- Include `generatorData` in your API request

### "Generator already exists"
**Problem:** Trying to add generator that's already loaded
**Solution:** This is normal and handled gracefully - the existing generator will be used

## Performance Comparison

| Metric | Dynamic Mode | Static Mode |
|--------|-------------|-------------|
| Startup time | ~2s | ~5s (loading N generators) |
| First render | ~3s | ~1s (generator pre-loaded) |
| Subsequent renders | ~1s | ~1s (cached) |
| Memory usage | Lower (only used generators) | Higher (all generators) |
| Flexibility | High | Low |

## Code References

**Dynamic loading logic:**
- `src/api/routes/batch.ts` line 36-40
- `src/rendering/HeadlessRenderer.ts` line 744-790 (`addGenerator`)

**Static loading logic:**
- `src/server.ts` line 177-204 (`loadGeneratorConfigurations`)
- `src/server.ts` line 209-268 (`transformGenerators`)

---

**Recommended:** Use **Dynamic Mode** for your current use case (frontend-driven rendering with live product data from API).
