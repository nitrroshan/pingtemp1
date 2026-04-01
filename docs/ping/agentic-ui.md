# AgenticUI — Vision-Based App Embedding

**Status:** Concept / Future Feature  
**Priority:** Future (Post-MVP)  
**Last Updated:** January 21, 2026

---

## Executive Summary

AgenticUI is a paradigm where **external apps render as images** in Ping's frontend, with **agents controlling the app** and **defining interactive hotspots**. The frontend becomes a simple image viewer with click handlers, while apps run headlessly in the backend under agent control.

---

## The Problem

Traditional app embedding has challenges:

| Approach | Problem |
|----------|---------|
| **iframes** | Security issues, no agent control, requires app's embed API |
| **SDK integration** | Each app needs custom integration work |
| **Native components** | Must build UI for every app type |
| **App APIs** | Limited to what the app exposes |

---

## The Solution: AgenticUI

```
┌─────────────────────────────────────────────────────────────────┐
│                        PING UI (Frontend)                        │
├──────────────────┬───────────────────────────────────────────────┤
│                  │   ┌─────────────────────────────────────────┐ │
│   Chat           │   │                                         │ │
│   (Ping handles) │   │   IMAGE FROM BACKEND APP                │ │
│                  │   │   (Word/PPT/Browser running headless)   │ │
│   ┌───────────┐  │   │                                         │ │
│   │ User:     │  │   │   ┌──────────────────────────────────┐  │ │
│   │ "Make it  │  │   │   │  Document Title        [×]       │  │ │
│   │  blue"    │  │   │   ├──────────────────────────────────┤  │ │
│   ├───────────┤  │   │   │                                  │  │ │
│   │ Agent:    │  │   │   │  This is some text...  ← HOTSPOT │  │ │
│   │ "Done!"   │  │   │   │  ─────────────────────           │  │ │
│   └───────────┘  │   │   │  More content here    ← HOTSPOT  │  │ │
│                  │   │   │                                  │  │ │
│                  │   │   └──────────────────────────────────┘  │ │
│                  │   │                                         │ │
│                  │   │   Agent-defined interaction hotspots    │ │
│                  │   └─────────────────────────────────────────┘ │
└──────────────────┴───────────────────────────────────────────────┘
```

### Key Insight

- **Frontend**: Just renders images + invisible clickable overlays
- **Backend**: Runs apps headlessly, captures screenshots, detects hotspots
- **Agent**: Controls the app, responds to user interactions
- **Chat**: Ping's existing chat handles natural language commands

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        AgenticUI System                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐                                           │
│  │ App Runner       │  Puppeteer, Playwright, or native         │
│  │ (Headless)       │  Runs apps without display                │
│  └────────┬─────────┘                                           │
│           │                                                      │
│           ▼                                                      │
│  ┌──────────────────┐                                           │
│  │ Frame Capturer   │  Screenshots at intervals or on change    │
│  └────────┬─────────┘                                           │
│           │                                                      │
│           ▼                                                      │
│  ┌──────────────────┐                                           │
│  │ Hotspot Analyzer │  Agent (vision) or DOM-based detection    │
│  │ (Agent/Vision)   │  Identifies interactive elements          │
│  └────────┬─────────┘                                           │
│           │                                                      │
│           ▼                                                      │
│  ┌──────────────────┐     ┌──────────────────┐                  │
│  │ Frame Streamer   │────▶│ Ping Frontend    │                  │
│  │ (WebSocket)      │     │ (Image + Overlay)│                  │
│  └──────────────────┘     └────────┬─────────┘                  │
│           ▲                        │                             │
│           │                        │ User Interactions           │
│           │                        ▼                             │
│  ┌────────┴─────────┐     ┌──────────────────┐                  │
│  │ Action Executor  │◀────│ Interaction      │                  │
│  │ (clicks, types)  │     │ Handler          │                  │
│  └──────────────────┘     └──────────────────┘                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### 1. AgenticFrame

The data structure sent from backend to frontend:

```typescript
interface AgenticFrame {
  // The visual representation
  image: string;              // Base64 PNG or URL
  imageType: 'full' | 'delta'; // Full frame or changed regions only
  
  // Agent-defined interaction points
  hotspots: Hotspot[];
  
  // App state for agent context
  appState: {
    type: string;             // 'word', 'browser', 'powerpoint'
    url?: string;
    title?: string;
    metadata?: Record<string, any>;
  };
  
  // Frame metadata
  timestamp: number;
  frameId: string;
}
```

### 2. Hotspot

Interactive regions defined by the agent or detected from DOM:

```typescript
interface Hotspot {
  id: string;
  
  // Interaction type
  type: 'click' | 'input' | 'drag' | 'scroll' | 'hover';
  
  // Position on the image
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  
  // UI hints
  label?: string;              // Tooltip text
  cursorStyle?: 'pointer' | 'text' | 'grab' | 'default';
  highlight?: boolean;         // Show visual indicator
  
  // Action binding
  action?: string;             // Pre-defined action ID
  actionParams?: Record<string, any>;
}
```

### 3. Interaction Event

When user interacts with a hotspot:

```typescript
interface InteractionEvent {
  type: 'click' | 'input' | 'drag' | 'scroll';
  hotspotId: string;
  
  // Type-specific data
  clickPosition?: { x: number, y: number };
  inputValue?: string;
  dragDelta?: { dx: number, dy: number };
  scrollDelta?: { dx: number, dy: number };
  
  // Context
  frameId: string;
  timestamp: number;
}
```

---

## Data Flow

### Flow 1: Initial App Load

```
User: "Open my Word document"
          ↓
Ping Agent receives request
          ↓
Agent → App Runner: Start headless Word
          ↓
App Runner → Frame Capturer: App ready
          ↓
Frame Capturer: Take screenshot
          ↓
Hotspot Analyzer: Detect interactive elements
          ↓
Frame Streamer → Frontend: AgenticFrame
          ↓
Frontend: Render image + hotspot overlays
```

### Flow 2: Natural Language Command

```
User: "Make the title blue"
          ↓
Ping Chat → Agent
          ↓
Agent: Interpret command
          ↓
Agent → App Runner: Select title, change color
          ↓
App state changes
          ↓
Frame Capturer: New screenshot
          ↓
Frame Streamer → Frontend: Updated frame
          ↓
Agent → Chat: "Done! Changed title to blue."
```

### Flow 3: Direct Hotspot Interaction

```
User clicks on a text hotspot
          ↓
Frontend: InteractionEvent { type: 'click', hotspotId: 'text-1' }
          ↓
Interaction Handler → Agent
          ↓
Agent decides action (select text, show menu, etc.)
          ↓
Agent → App Runner: Perform click at coordinates
          ↓
New screenshot + hotspots
          ↓
Frontend: Updated frame
```

---

## Implementation Components

### Backend Components

#### 1. AppRunner

Manages headless app instances:

```typescript
interface AppRunner {
  // Lifecycle
  start(config: AppConfig): Promise<AppInstance>;
  stop(instanceId: string): Promise<void>;
  
  // Interaction
  click(instanceId: string, x: number, y: number): Promise<void>;
  type(instanceId: string, text: string): Promise<void>;
  scroll(instanceId: string, dx: number, dy: number): Promise<void>;
  
  // State
  screenshot(instanceId: string): Promise<Buffer>;
  getDOM(instanceId: string): Promise<DOMSnapshot>; // For web apps
}

interface AppConfig {
  type: 'browser' | 'electron' | 'native';
  url?: string;           // For browser
  executable?: string;    // For native apps
  args?: string[];
}
```

#### 2. FrameCapturer

Captures and optimizes screenshots:

```typescript
interface FrameCapturer {
  // Capture modes
  captureFullFrame(instance: AppInstance): Promise<Buffer>;
  captureDelta(instance: AppInstance, previousFrame: Buffer): Promise<DeltaFrame>;
  
  // Optimization
  compress(frame: Buffer, quality: number): Promise<Buffer>;
  resize(frame: Buffer, maxWidth: number): Promise<Buffer>;
}
```

#### 3. HotspotAnalyzer

Detects interactive elements:

```typescript
interface HotspotAnalyzer {
  // DOM-based (for web apps)
  analyzeDOM(dom: DOMSnapshot): Promise<Hotspot[]>;
  
  // Vision-based (for any app)
  analyzeImage(image: Buffer, agent: Agent): Promise<Hotspot[]>;
  
  // Hybrid
  analyze(instance: AppInstance): Promise<Hotspot[]>;
}
```

### Frontend Components

#### 1. AgenticViewer

React component for rendering frames:

```tsx
interface AgenticViewerProps {
  frame: AgenticFrame;
  onInteraction: (event: InteractionEvent) => void;
  showHotspotHints?: boolean;
}

const AgenticViewer: React.FC<AgenticViewerProps> = ({
  frame,
  onInteraction,
  showHotspotHints = false
}) => {
  return (
    <div className="relative select-none">
      {/* App screenshot */}
      <img 
        src={`data:image/png;base64,${frame.image}`}
        className="w-full"
        draggable={false}
      />
      
      {/* Hotspot overlays */}
      {frame.hotspots.map(hotspot => (
        <HotspotOverlay
          key={hotspot.id}
          hotspot={hotspot}
          showHint={showHotspotHints}
          onInteract={(event) => onInteraction({
            ...event,
            hotspotId: hotspot.id,
            frameId: frame.frameId
          })}
        />
      ))}
    </div>
  );
};
```

#### 2. HotspotOverlay

Individual hotspot interaction:

```tsx
const HotspotOverlay: React.FC<{
  hotspot: Hotspot;
  showHint: boolean;
  onInteract: (event: Partial<InteractionEvent>) => void;
}> = ({ hotspot, showHint, onInteract }) => {
  const [inputMode, setInputMode] = useState(false);
  
  const handleClick = (e: React.MouseEvent) => {
    if (hotspot.type === 'input') {
      setInputMode(true);
    } else {
      onInteract({
        type: 'click',
        clickPosition: { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }
      });
    }
  };
  
  return (
    <div
      className={cn(
        "absolute transition-colors",
        hotspot.cursorStyle === 'pointer' && "cursor-pointer",
        hotspot.cursorStyle === 'text' && "cursor-text",
        hotspot.highlight && "ring-2 ring-blue-500",
        "hover:bg-blue-500/10"
      )}
      style={{
        left: hotspot.bounds.x,
        top: hotspot.bounds.y,
        width: hotspot.bounds.width,
        height: hotspot.bounds.height,
      }}
      onClick={handleClick}
      title={showHint ? hotspot.label : undefined}
    >
      {inputMode && (
        <input
          autoFocus
          className="w-full h-full bg-transparent"
          onBlur={() => setInputMode(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onInteract({ type: 'input', inputValue: e.currentTarget.value });
              setInputMode(false);
            }
          }}
        />
      )}
    </div>
  );
};
```

---

## Hotspot Detection Strategies

### Strategy 1: DOM-Based (Web Apps)

For apps running in Playwright/Puppeteer:

```typescript
async function detectHotspotsFromDOM(page: Page): Promise<Hotspot[]> {
  return await page.evaluate(() => {
    const interactiveSelectors = [
      'button', 'a', 'input', 'textarea', 'select',
      '[onclick]', '[role="button"]', '[tabindex]',
      '.clickable', '[data-action]'
    ];
    
    const elements = document.querySelectorAll(interactiveSelectors.join(','));
    
    return Array.from(elements)
      .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0)
      .map(el => {
        const rect = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        
        return {
          id: el.id || `${tag}-${Math.random().toString(36).substr(2, 9)}`,
          type: (tag === 'input' || tag === 'textarea') ? 'input' : 'click',
          bounds: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height
          },
          label: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 50),
          cursorStyle: tag === 'input' ? 'text' : 'pointer'
        };
      });
  });
}
```

### Strategy 2: Vision-Based (Any App)

For native apps or when DOM isn't accessible:

```typescript
async function detectHotspotsFromVision(
  screenshot: Buffer,
  agent: Agent
): Promise<Hotspot[]> {
  const response = await agent.invoke({
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', data: screenshot.toString('base64') }
        },
        {
          type: 'text',
          text: `Analyze this application screenshot and identify all interactive elements.
                 Return a JSON array of hotspots with: id, type (click/input/drag), 
                 bounds (x, y, width, height), and label.`
        }
      ]
    }],
    responseFormat: { type: 'json_object' }
  });
  
  return JSON.parse(response.content).hotspots;
}
```

### Strategy 3: Hybrid (Best of Both)

```typescript
async function detectHotspots(instance: AppInstance): Promise<Hotspot[]> {
  if (instance.type === 'browser') {
    // Use fast DOM-based detection
    return detectHotspotsFromDOM(instance.page);
  } else {
    // Fall back to vision for native apps
    const screenshot = await instance.screenshot();
    return detectHotspotsFromVision(screenshot, visionAgent);
  }
}
```

---

## Optimization Strategies

### 1. Delta Frames

Only send changed regions:

```typescript
interface DeltaFrame {
  regions: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageData: string;  // Base64 of just this region
  }[];
  removedHotspots: string[];
  addedHotspots: Hotspot[];
  modifiedHotspots: Partial<Hotspot>[];
}
```

### 2. Adaptive Quality

Reduce quality during interaction, increase when idle:

```typescript
const qualitySettings = {
  idle: { quality: 90, maxWidth: 1920 },
  interacting: { quality: 60, maxWidth: 1280 },
  scrolling: { quality: 40, maxWidth: 960 }
};
```

### 3. Predictive Hotspots

Cache hotspots that don't change often:

```typescript
// Don't re-analyze toolbar buttons every frame
const staticHotspots = hotspots.filter(h => h.isStatic);
const dynamicHotspots = await analyzer.detectDynamic(instance);
return [...staticHotspots, ...dynamicHotspots];
```

---

## Comparison: AgenticUI vs Traditional

| Aspect | Traditional (iframe/SDK) | AgenticUI |
|--------|--------------------------|-----------|
| **App Support** | Only apps with embed APIs | ANY visual app |
| **Integration Effort** | Custom per app | One generic system |
| **Agent Control** | Limited to APIs | Full visual control |
| **Frontend Complexity** | Load app's JS/CSS | Just images |
| **Security** | App in user's browser | Isolated in backend |
| **Latency** | Low (local) | Medium (network) |
| **Bandwidth** | Varies | ~50-200KB/frame |
| **Offline Apps** | No | Yes (headless desktop) |
| **Text Input** | Native | Overlay + forward |

---

## Use Cases

### 1. Document Editing
```
User: "Open my quarterly report and fix the formatting"
Agent: Opens Word headlessly, shows as image
User: Clicks on a paragraph (hotspot)
Agent: Shows context menu for that paragraph
User: "Make this a bullet list"
Agent: Executes in Word, sends updated frame
```

### 2. Web Browsing
```
User: "Research competitors for our product"
Agent: Opens browser, navigates to search
Frame: Shows search results as image with link hotspots
User: Clicks on a result
Agent: Navigates, extracts info, updates frame
```

### 3. Design Tools
```
User: "Create a landing page mockup"
Agent: Opens Figma/design tool headlessly
Frame: Shows canvas with element hotspots
User: "Move that button to the right"
Agent: Drags element, updates frame
```

---

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| App isolation | Each app runs in isolated container |
| Data leakage | Screenshots only sent to authorized users |
| Credential handling | Credentials stored encrypted, injected at runtime |
| Network access | Apps have controlled network policies |
| Resource limits | CPU/memory limits per app instance |

---

## Estimated Implementation Effort

| Component | Effort | Priority |
|-----------|--------|----------|
| AppRunner (Playwright) | 3-4 days | P0 |
| FrameCapturer | 2 days | P0 |
| HotspotAnalyzer (DOM) | 2-3 days | P0 |
| Frame streaming (WebSocket) | 2 days | P0 |
| AgenticViewer component | 2-3 days | P0 |
| Interaction handling | 2 days | P0 |
| **MVP Total** | **~2 weeks** | |
| Delta frames | 3 days | P1 |
| Vision-based hotspots | 4-5 days | P1 |
| Native app support | 1 week | P2 |
| Multi-app sessions | 3-4 days | P2 |

---

## Open Questions

1. **Latency targets**: What's acceptable delay between click and frame update?
2. **Mobile support**: How to handle touch vs mouse interactions?
3. **Accessibility**: How to support screen readers with image-based UI?
4. **Multi-monitor**: Support for apps spanning multiple screens?
5. **Audio/Video**: Handle apps with multimedia content?

---

## Related Documents

- [Ping Vision](./vision.md) - Overall platform vision
- [Ping Architecture](./architecture.md) - Technical architecture
- [Evolving Agent](../features/evolving-agent/feature_architecture.md) - Agent framework
- [External Agent Support](../features/evolving-agent/feature_architecture.md#v11---external-agent-support) - External agent integration

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-21 | Initial concept document |
