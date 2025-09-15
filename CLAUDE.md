# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Commands
- `npm run dev` - Start development server with turbopack
- `npm run build` - Build production version with turbopack  
- `npm start` - Start production server
- `npm run lint` - Run ESLint

### Testing
No test framework is currently configured in this project.

## Architecture Overview

This is a Next.js 15 application that integrates Live2D character models with AI chat functionality using the Anthropic Claude API.

### Key Technologies
- **Next.js 15** with App Router
- **pixi-live2d-display-lipsyncpatch** - Live2D model rendering with lip sync capabilities
- **PIXI.js 7** - 2D graphics rendering engine
- **Anthropic AI SDK** - Claude API integration for chat
- **TailwindCSS 4** - Styling framework

### Core Components

#### Live2D Integration (`src/app/page.tsx`)
- Uses `pixi-live2d-display-lipsyncpatch/cubism4` for Live2D model rendering
- Model files located in `public/live2d/Resources/Haru/`
- Implements motion control, facial expressions, and lip-synced audio playback
- **Critical**: Live2D Cubism Core must be loaded via Script component in layout.tsx before interactive use

#### Motion System
- Motions organized by groups ("Idle", "TapBody") with numeric indices
- Priority system (higher numbers override lower priority motions)
- Usage: `model.motion(group, index, priority)`

#### Expression System
- Expressions controlled by name (F01, F02, etc.)
- Independent from motion system
- Usage: `model.expression(expressionName)`

#### Audio with Lip Sync
- **Important**: Use `model.speak(audioUrl)` for lip-synced audio, NOT regular Audio API
- Automatically analyzes audio and controls `ParamMouthOpenY` parameter
- Audio files stored in `public/live2d/Resources/Haru/sounds/`

#### Chat API (`src/app/api/chat/route.ts`)
- Streaming text responses using Anthropic Claude 3.5 Sonnet
- Includes VOICEVOX Query type definitions (unused currently)
- Requires ANTHROPIC_API_KEY environment variable

### File Structure
```
src/app/
├── layout.tsx          # Root layout with Live2D Cubism Core script loading
├── page.tsx           # Main Live2D interface component
└── api/chat/route.ts  # Claude API endpoint

public/live2d/Resources/Haru/
├── *.model3.json      # Model definition and configuration
├── *.moc3             # Binary model data
├── expressions/       # Facial expression files (.exp3.json)
├── motions/          # Animation files (.motion3.json)
└── sounds/           # Audio files for lip sync (.wav)
```

### Live2D Model Configuration
- Model definition in `Haru.model3.json` defines:
  - Available motions organized by group
  - Expression mappings
  - LipSync parameter bindings
  - Physics and pose settings

### Environment Requirements
- Node.js environment with Next.js 15 support
- ANTHROPIC_API_KEY for chat functionality
- Modern browser with WebGL support for Live2D rendering

## Development Notes

### Live2D Setup
1. Live2D Cubism Core script must load before any Live2D components
2. Model loading is asynchronous - always check model state before operations
3. Canvas resizing requires manual model repositioning

### Audio Integration
- Always use `model.speak()` for lip-synced audio
- Audio files must be accessible via public URL
- Error handling required for audio loading/playback failures

### Performance Considerations
- PIXI.js application manages render loop automatically
- Model positioning calculated based on canvas dimensions
- Event listeners for resize must be properly cleaned up