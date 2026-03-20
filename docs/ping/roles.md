# Roles — Real-World Professional Thinking Patterns

This document analyzes how real-world professionals think — their mental models, reasoning patterns, decision frameworks, and cognitive approaches. Use this to design AI agents that authentically emulate professional thinking.

---

## Table of Contents

1. [Technology Roles](#technology-roles)
2. [Business & Strategy Roles](#business--strategy-roles)
3. [Creative Roles](#creative-roles)
4. [Research & Analysis Roles](#research--analysis-roles)
5. [Operations Roles](#operations-roles)
6. [Leadership Roles](#leadership-roles)
7. [Specialized Roles](#specialized-roles)

---

# Technology Roles

## Software Developer

**Core Mental Model:** Code as a living system that must be maintainable, testable, and extensible.

### How Developers Think

**Primary Question:** "How do I translate this requirement into working, maintainable code?"

#### Thinking Layers

1. **Problem Decomposition**
   - "What's the smallest piece I can build first?"
   - Breaks problems into functions, modules, components
   - Identifies reusable patterns vs one-off solutions
   - Thinks in interfaces before implementations

2. **Pattern Recognition**
   - "Have I seen this problem before?"
   - Maps new problems to known design patterns
   - Recognizes anti-patterns and code smells
   - Draws from language idioms and framework conventions

3. **Edge Case Paranoia**
   - "What could break this?"
   - Null values, empty arrays, boundary conditions
   - Concurrent access, race conditions
   - Invalid input, network failures, timeouts

4. **Debugging Mindset**
   - "Where did my assumption go wrong?"
   - Binary search through the problem space
   - Reproduces issues before fixing
   - Checks logs, state, and data flow

5. **Future Self Empathy**
   - "Will I understand this in 6 months?"
   - Writes self-documenting code
   - Adds comments for "why" not "what"
   - Considers onboarding of new team members

#### Decision Framework
```
WHEN faced with implementation choice:
  1. Does it solve the immediate problem?
  2. Is it the simplest solution that works?
  3. Can I test it easily?
  4. Will it be readable to others?
  5. Does it follow existing patterns in the codebase?
  6. What's the cost of changing it later?
```

#### Internal Dialogue
- "This is too clever. Simplify."
- "I'm repeating myself. Time to abstract."
- "What happens if this throws?"
- "The tests pass but does it actually work?"
- "Let me trace through the data flow..."

---

## Software Architect

**Core Mental Model:** Systems as interconnected components with contracts, constraints, and trade-offs.

### How Architects Think

**Primary Question:** "What's the right structure to support current and future needs?"

#### Thinking Layers

1. **Constraint Mapping**
   - "What are the non-negotiables?"
   - Performance requirements (latency, throughput)
   - Scale expectations (users, data volume)
   - Budget, timeline, team capabilities
   - Regulatory and compliance requirements

2. **Trade-off Analysis**
   - "What am I giving up with each choice?"
   - Consistency vs availability (CAP theorem)
   - Flexibility vs simplicity
   - Build vs buy
   - Monolith vs microservices

3. **Failure Mode Thinking**
   - "How will this break?"
   - Single points of failure
   - Cascade failures
   - Recovery procedures
   - Graceful degradation

4. **Evolution Planning**
   - "How will requirements change?"
   - Designs for the 80% case, extensible for 20%
   - Avoids over-engineering
   - Considers migration paths

5. **Communication Design**
   - "How do I make this understandable?"
   - Creates diagrams at multiple zoom levels
   - Documents decisions AND rationale
   - Builds shared vocabulary

#### Decision Framework
```
FOR each architectural decision:
  1. What problem does this solve?
  2. What are the alternatives?
  3. What trade-offs does each option make?
  4. What's the reversibility cost?
  5. What's the blast radius if we're wrong?
  6. Does the team have the skills for this?
```

#### Internal Dialogue
- "This adds complexity. Is it worth it?"
- "What's the simplest thing that could possibly work?"
- "We're optimizing for the wrong thing."
- "That's a future problem. Don't solve it now."
- "The real constraint is organizational, not technical."

---

## DevOps / SRE Engineer

**Core Mental Model:** Systems as living organisms that need monitoring, healing, and evolution.

### How DevOps Engineers Think

**Primary Question:** "How do I make this system reliable, observable, and changeable?"

#### Thinking Layers

1. **Observability First**
   - "Can I tell what's happening inside?"
   - Logs, metrics, traces
   - Dashboards and alerts
   - "If it's not monitored, it doesn't exist"

2. **Automation Obsession**
   - "If I do this twice, I'll script it"
   - Eliminates manual steps
   - Infrastructure as code
   - Reproducible environments

3. **Blast Radius Containment**
   - "How do I limit damage?"
   - Feature flags, canary deployments
   - Rollback procedures
   - Circuit breakers

4. **Incident Response**
   - "What's the fastest path to recovery?"
   - Runbooks and playbooks
   - Communication protocols
   - Post-incident reviews without blame

5. **Capacity Planning**
   - "When will we run out?"
   - Resource trends and projections
   - Cost optimization
   - Auto-scaling strategies

#### Decision Framework
```
WHEN designing infrastructure:
  1. Can we deploy this with zero downtime?
  2. Can we roll back in under 5 minutes?
  3. Will we know when it fails?
  4. Can we reproduce this environment?
  5. Is this documented enough for 3am?
```

#### Internal Dialogue
- "If I have to SSH into a box, something is wrong."
- "What will page me at 3am?"
- "This works but it's not reproducible."
- "That alert is too noisy. People will ignore it."
- "Let's game-day this before production."

---

## Data Engineer

**Core Mental Model:** Data as a product that flows through pipelines with quality guarantees.

### How Data Engineers Think

**Primary Question:** "How do I get the right data to the right place at the right time?"

#### Thinking Layers

1. **Data Flow Visualization**
   - "Where does this data come from and go to?"
   - Source systems, transformations, destinations
   - Lineage and provenance
   - Dependencies and coupling

2. **Quality Obsession**
   - "Can I trust this data?"
   - Schema validation
   - Null handling, type coercion
   - Deduplication, consistency checks

3. **Scale Thinking**
   - "What happens at 10x, 100x volume?"
   - Batch vs streaming trade-offs
   - Partitioning strategies
   - Processing time vs data freshness

4. **Failure Recovery**
   - "What if this step fails?"
   - Idempotent operations
   - Checkpoint and restart
   - Dead letter queues

5. **Schema Evolution**
   - "How will this data change?"
   - Forward/backward compatibility
   - Versioning strategies
   - Migration planning

#### Decision Framework
```
FOR data pipeline decisions:
  1. What's the SLA for data freshness?
  2. What's the acceptable error rate?
  3. How will we detect data quality issues?
  4. What happens when upstream schemas change?
  5. Can we reprocess historical data?
```

---

## Security Engineer

**Core Mental Model:** Systems as attack surfaces with threats, vulnerabilities, and defenses.

### How Security Engineers Think

**Primary Question:** "How would an attacker exploit this, and how do I prevent it?"

#### Thinking Layers

1. **Adversarial Mindset**
   - "If I were attacking this, where would I start?"
   - Thinks like an attacker
   - Questions every assumption
   - Assumes breach will happen

2. **Defense in Depth**
   - "What if this control fails?"
   - Multiple layers of protection
   - No single point of trust
   - Principle of least privilege

3. **Threat Modeling**
   - "What are we protecting and from whom?"
   - Asset identification
   - Threat actor profiling
   - Attack vector enumeration

4. **Risk Quantification**
   - "How bad is this, really?"
   - Likelihood × Impact
   - Prioritizes high-risk items
   - Accepts some risk as inevitable

5. **Compliance Mapping**
   - "What are we required to do?"
   - Regulatory requirements
   - Industry standards
   - Audit trails

#### Decision Framework
```
WHEN evaluating security:
  1. What's the worst case if this is exploited?
  2. Who has access to this and why?
  3. What's logged and for how long?
  4. How would we detect a breach?
  5. What's our response plan?
```

#### Internal Dialogue
- "That's security through obscurity. It doesn't count."
- "Why does this need admin access?"
- "What if that token gets leaked?"
- "Never trust client input. Ever."
- "The human is always the weakest link."

---

## QA / Test Engineer

**Core Mental Model:** Software as a hypothesis that must be validated through evidence.

### How QA Engineers Think

**Primary Question:** "How do I prove this works correctly, and how might it fail?"

#### Thinking Layers

1. **Requirements Skepticism**
   - "What does 'it should work' actually mean?"
   - Converts vague requirements to testable conditions
   - Asks "what about..." questions
   - Documents assumptions explicitly

2. **Boundary Hunting**
   - "Where are the edges?"
   - Min/max values, empty states
   - Off-by-one errors
   - State transitions

3. **Combinatorial Thinking**
   - "What combinations matter?"
   - Feature interactions
   - Environment variations
   - User permission combinations

4. **User Empathy**
   - "How will a real person use this?"
   - Non-happy-path scenarios
   - Confused users, accidental input
   - Accessibility considerations

5. **Risk-Based Prioritization**
   - "What's most likely to break?"
   - Focus on critical paths first
   - New code > old code
   - Complex > simple

#### Decision Framework
```
FOR test planning:
  1. What are the acceptance criteria?
  2. What's the worst case if this fails?
  3. What's changed since last release?
  4. What's the test coverage vs risk?
  5. Can this be automated?
```

#### Internal Dialogue
- "That's the happy path. What about errors?"
- "They say it works. Show me."
- "What if the user does something stupid?"
- "This test is flaky. It's worse than no test."
- "Edge cases aren't edge cases if users hit them."

---

# Business & Strategy Roles

## Product Manager

**Core Mental Model:** Products as solutions to user problems, balanced against business viability.

### How Product Managers Think

**Primary Question:** "What should we build that users need and the business can sustain?"

#### Thinking Layers

1. **Problem Validation**
   - "Is this a real problem worth solving?"
   - Distinguishes problems from solutions
   - Quantifies pain points
   - Validates with actual users, not assumptions

2. **Prioritization Frameworks**
   - "What's the highest value we can deliver now?"
   - Impact vs effort matrices
   - RICE, MoSCoW, or custom frameworks
   - Says "no" more than "yes"

3. **User Mental Models**
   - "How do users think about this?"
   - Jobs-to-be-done thinking
   - User journey mapping
   - Cognitive load considerations

4. **Stakeholder Balancing**
   - "Who needs what from this?"
   - Engineering constraints
   - Business goals
   - User needs
   - Support and operations concerns

5. **Outcome vs Output**
   - "Did we change behavior, not just ship features?"
   - Measures results, not activity
   - Defines success metrics upfront
   - Iterates based on data

#### Decision Framework
```
FOR feature decisions:
  1. What user problem does this solve?
  2. How will we know it worked?
  3. What's the simplest version that tests the hypothesis?
  4. What's the opportunity cost?
  5. Can we reverse this if wrong?
```

#### Internal Dialogue
- "That's a solution, not a problem. What's the real problem?"
- "If everything is priority 1, nothing is."
- "What does the data say?"
- "We're building what they asked for, not what they need."
- "Ship to learn, don't learn to ship."

---

## Project Manager

**Core Mental Model:** Projects as constrained systems with scope, time, cost, and risk.

### How Project Managers Think

**Primary Question:** "How do I deliver this on time, on budget, with acceptable quality?"

#### Thinking Layers

1. **Scope Vigilance**
   - "Is this in or out?"
   - Change control discipline
   - Feature creep detection
   - Trade-off negotiation

2. **Dependency Mapping**
   - "What blocks what?"
   - Critical path identification
   - Resource contention
   - External dependencies

3. **Risk Anticipation**
   - "What could go wrong?"
   - Risk registers and mitigation plans
   - Early warning indicators
   - Contingency buffers

4. **Communication Cadence**
   - "Who needs to know what, when?"
   - Status reporting
   - Escalation paths
   - Meeting efficiency

5. **Team Dynamics**
   - "What's blocking the team?"
   - Removes obstacles
   - Manages expectations
   - Celebrates wins

#### Decision Framework
```
WHEN managing constraints:
  1. What's fixed: scope, time, or budget?
  2. What's the minimum viable delivery?
  3. What risks have the highest impact × probability?
  4. Who is the decision-maker here?
  5. What's the communication plan?
```

#### Internal Dialogue
- "That's not a status update, that's a surprise."
- "Good news travels fast. Bad news needs to travel faster."
- "Under-promise, over-deliver."
- "The plan is wrong. It's still useful."
- "We need a decision, not more discussion."

---

## Business Analyst

**Core Mental Model:** Business processes as systems that can be understood, documented, and improved.

### How Business Analysts Think

**Primary Question:** "What does the business need, and how do we translate that to requirements?"

#### Thinking Layers

1. **Stakeholder Archaeology**
   - "What do they really mean?"
   - Interviews and observation
   - Reads between the lines
   - Identifies hidden assumptions

2. **Process Mapping**
   - "What actually happens today?"
   - Current state documentation
   - Pain points and bottlenecks
   - Exception handling

3. **Requirements Crystallization**
   - "How do we make this unambiguous?"
   - User stories with acceptance criteria
   - Functional and non-functional requirements
   - Traceability to business goals

4. **Gap Analysis**
   - "What's the delta between now and desired?"
   - Current vs future state
   - Impact assessment
   - Migration considerations

5. **Validation Loops**
   - "Did I understand correctly?"
   - Confirms with stakeholders
   - Prototypes and mockups
   - Scenario walkthroughs

#### Decision Framework
```
FOR requirements gathering:
  1. What business outcome drives this?
  2. Who are all the stakeholders?
  3. What does success look like?
  4. What constraints exist?
  5. How will we validate understanding?
```

---

## Strategy Consultant

**Core Mental Model:** Business situations as structured problems with frameworks and data-driven solutions.

### How Consultants Think

**Primary Question:** "What's the real problem, and what's the evidence-based recommendation?"

#### Thinking Layers

1. **Problem Structuring**
   - "How do I break this into analyzable pieces?"
   - MECE (Mutually Exclusive, Collectively Exhaustive)
   - Issue trees and hypothesis trees
   - 80/20 focus

2. **Framework Application**
   - "What lens fits this situation?"
   - Porter's Five Forces, Value Chain
   - 3Cs, SWOT, BCG Matrix
   - Knows when frameworks don't apply

3. **Data Triangulation**
   - "What evidence supports this?"
   - Multiple data sources
   - Quantitative and qualitative
   - Separates facts from opinions

4. **Synthesis Skills**
   - "So what?"
   - Insight extraction
   - Pattern recognition across data
   - Actionable recommendations

5. **Stakeholder Communication**
   - "How do I make this land?"
   - Pyramid principle (lead with answer)
   - Executive-ready materials
   - Tailors message to audience

#### Decision Framework
```
WHEN structuring analysis:
  1. What's the key question?
  2. What sub-questions must be answered?
  3. What data would prove/disprove each hypothesis?
  4. What's the minimum analysis needed?
  5. What's the "so what" for leadership?
```

#### Internal Dialogue
- "What's the one thing that would change the answer?"
- "Is this MECE?"
- "That's interesting, but is it actionable?"
- "We're boiling the ocean. Focus."
- "The client asked the wrong question."

---

# Creative Roles

## UX Designer

**Core Mental Model:** Digital experiences as conversations between humans and systems.

### How UX Designers Think

**Primary Question:** "How do I help users achieve their goals with minimal friction?"

#### Thinking Layers

1. **User Empathy**
   - "Who is this person and what do they need?"
   - Personas and user research
   - Jobs-to-be-done
   - Emotional states and contexts

2. **Information Architecture**
   - "How should this be organized?"
   - Mental models
   - Navigation patterns
   - Content hierarchy

3. **Interaction Design**
   - "How does this behave?"
   - Affordances and signifiers
   - Feedback loops
   - Error prevention and recovery

4. **Visual Hierarchy**
   - "What should they see first?"
   - Attention guidance
   - Contrast and grouping
   - Consistency and patterns

5. **Accessibility**
   - "Can everyone use this?"
   - Screen readers, keyboard navigation
   - Color contrast, text sizing
   - Cognitive load reduction

#### Decision Framework
```
FOR design decisions:
  1. What user goal does this serve?
  2. What's the simplest solution?
  3. Is this consistent with existing patterns?
  4. What happens when things go wrong?
  5. Can this be misunderstood?
```

#### Internal Dialogue
- "That's clever, but is it usable?"
- "Users don't read. They scan."
- "Every click is a chance to lose someone."
- "The best interface is no interface."
- "Make the right thing the easy thing."

---

## UI Designer

**Core Mental Model:** Interfaces as visual systems with rules, components, and aesthetic coherence.

### How UI Designers Think

**Primary Question:** "How do I make this visually clear, consistent, and appealing?"

#### Thinking Layers

1. **Visual Language**
   - "What's the personality of this product?"
   - Color palette, typography, spacing
   - Mood and tone
   - Brand alignment

2. **Component Thinking**
   - "What are the building blocks?"
   - Buttons, inputs, cards, modals
   - Reusable patterns
   - Design system contribution

3. **Layout and Composition**
   - "How does this fit together?"
   - Grid systems
   - White space
   - Visual balance

4. **State Design**
   - "What are all the variations?"
   - Default, hover, active, disabled, error
   - Loading states
   - Empty states

5. **Motion and Feedback**
   - "How does change feel?"
   - Micro-interactions
   - Transitions and animations
   - Perceived performance

#### Decision Framework
```
FOR visual decisions:
  1. Does this follow the design system?
  2. Is the hierarchy clear?
  3. Is this accessible (contrast, size)?
  4. Does this work at all breakpoints?
  5. Have I designed all states?
```

---

## Content Strategist / Copywriter

**Core Mental Model:** Words as tools for guiding behavior and building relationships.

### How Content Strategists Think

**Primary Question:** "What words will help users understand and take action?"

#### Thinking Layers

1. **Audience Awareness**
   - "Who is reading this and what do they know?"
   - Reading level and vocabulary
   - Cultural context
   - Emotional state

2. **Voice and Tone**
   - "How should this sound?"
   - Consistent brand voice
   - Tone adapts to context (error vs success)
   - Personality without friction

3. **Information Hierarchy**
   - "What do they need first?"
   - Frontloads important information
   - Scannable structure
   - Progressive disclosure

4. **Action Orientation**
   - "What should they do next?"
   - Clear calls to action
   - Reduces ambiguity
   - Motivates without manipulation

5. **Localization Thinking**
   - "Will this work globally?"
   - Avoids idioms and cultural assumptions
   - Considers text expansion
   - Placeholder-friendly structure

#### Decision Framework
```
FOR content decisions:
  1. What action do we want?
  2. What's the minimum needed to understand?
  3. Is this consistent with voice guidelines?
  4. Could this be misunderstood?
  5. Is this scannable?
```

#### Internal Dialogue
- "That's five words too many."
- "Don't make me think means don't make me read."
- "Error messages are product design."
- "If you have to explain it, rewrite it."
- "The subject line is 80% of the email."

---

# Research & Analysis Roles

## Research Analyst

**Core Mental Model:** Knowledge as structured investigation with sources, methods, and conclusions.

### How Research Analysts Think

**Primary Question:** "What's the defensible answer based on evidence?"

#### Thinking Layers

1. **Question Formulation**
   - "What exactly are we trying to learn?"
   - Converts vague asks into specific questions
   - Identifies sub-questions
   - Scopes what's in/out

2. **Source Evaluation**
   - "Can I trust this information?"
   - Primary vs secondary sources
   - Credibility and bias assessment
   - Recency and relevance

3. **Synthesis**
   - "What do the pieces add up to?"
   - Cross-referencing sources
   - Identifying patterns and contradictions
   - Building the narrative

4. **Uncertainty Acknowledgment**
   - "What don't we know?"
   - Confidence levels
   - Gaps in data
   - Alternative interpretations

5. **Communication**
   - "How do I make this useful?"
   - Executive summaries
   - Supporting evidence
   - Actionable recommendations

#### Decision Framework
```
FOR research quality:
  1. Is the question answerable?
  2. What's the best available evidence?
  3. What are the limitations?
  4. What's the confidence level?
  5. What action does this support?
```

---

## Data Scientist

**Core Mental Model:** Data as evidence requiring statistical rigor and practical interpretation.

### How Data Scientists Think

**Primary Question:** "What does the data actually tell us, with what confidence?"

#### Thinking Layers

1. **Problem Framing**
   - "Is this a prediction, inference, or description problem?"
   - Supervised vs unsupervised
   - Correlation vs causation awareness
   - Business outcome connection

2. **Data Skepticism**
   - "What's wrong with this data?"
   - Selection bias, survivorship bias
   - Missing data patterns
   - Data leakage

3. **Model Selection**
   - "What's the simplest model that might work?"
   - Baseline before complexity
   - Interpretability vs accuracy trade-offs
   - Cross-validation discipline

4. **Statistical Rigor**
   - "Am I fooling myself?"
   - Confidence intervals, not point estimates
   - Multiple comparison corrections
   - Effect size, not just significance

5. **Deployment Thinking**
   - "Will this work in production?"
   - Training/serving skew
   - Model monitoring and drift
   - A/B testing design

#### Decision Framework
```
FOR modeling decisions:
  1. What would a good baseline be?
  2. What data would change our approach?
  3. What's the cost of being wrong?
  4. How will we know if the model degrades?
  5. Can stakeholders understand and trust this?
```

#### Internal Dialogue
- "Correlation is not causation. What's the mechanism?"
- "p < 0.05 is not magic."
- "The model is overfit until proven otherwise."
- "What's the null hypothesis?"
- "More data beats a better algorithm."

---

## Market Researcher

**Core Mental Model:** Markets as ecosystems of competitors, customers, and trends.

### How Market Researchers Think

**Primary Question:** "What does the market landscape look like, and where are the opportunities?"

#### Thinking Layers

1. **Competitive Mapping**
   - "Who else is playing and how?"
   - Direct and indirect competitors
   - Positioning and differentiation
   - Strengths and weaknesses

2. **Customer Segmentation**
   - "Who are the distinct buyer types?"
   - Demographics and psychographics
   - Needs and pain points
   - Willingness to pay

3. **Trend Identification**
   - "What's changing and why?"
   - Market size and growth
   - Technology shifts
   - Regulatory changes

4. **Opportunity Assessment**
   - "Where's the whitespace?"
   - Underserved segments
   - Competitive gaps
   - Market timing

5. **Validation Approach**
   - "How do we test assumptions?"
   - Surveys and interviews
   - Secondary research
   - Competitive intelligence

---

# Operations Roles

## Operations Manager

**Core Mental Model:** Organizations as systems of processes that can be measured, improved, and scaled.

### How Operations Managers Think

**Primary Question:** "How do I make this run smoothly, efficiently, and predictably?"

#### Thinking Layers

1. **Process Mapping**
   - "What are the steps and who does them?"
   - Value stream analysis
   - Bottleneck identification
   - Handoff points

2. **Metrics Obsession**
   - "What gets measured gets managed"
   - Leading vs lagging indicators
   - SLAs and SLOs
   - Dashboard design

3. **Efficiency Hunting**
   - "What's wasteful?"
   - Lean thinking
   - Automation opportunities
   - Batch vs flow optimization

4. **Capacity Planning**
   - "Can we handle the load?"
   - Demand forecasting
   - Resource allocation
   - Contingency planning

5. **Continuous Improvement**
   - "How do we get better?"
   - Root cause analysis
   - Retrospectives
   - Incremental optimization

#### Decision Framework
```
FOR operational decisions:
  1. What's the current baseline?
  2. What's the target state?
  3. What's the cost of doing nothing?
  4. What's the smallest change we can test?
  5. How will we measure success?
```

---

## Customer Support Lead

**Core Mental Model:** Support as a system for resolving issues AND improving the product.

### How Support Leads Think

**Primary Question:** "How do I resolve issues quickly while learning from them?"

#### Thinking Layers

1. **Empathy First**
   - "What is the customer actually experiencing?"
   - Emotional acknowledgment
   - Context gathering
   - Expectation alignment

2. **Pattern Recognition**
   - "Have we seen this before?"
   - Knowledge base utilization
   - Common issue identification
   - Escalation criteria

3. **Resolution Efficiency**
   - "What's the fastest path to resolution?"
   - First contact resolution goals
   - Tier routing
   - Self-service deflection

4. **Feedback Loop**
   - "What should the product team know?"
   - Bug reporting
   - Feature requests aggregation
   - Voice of customer synthesis

5. **Team Health**
   - "How are agents doing?"
   - Workload distribution
   - Burnout prevention
   - Skill development

---

# Leadership Roles

## Engineering Manager

**Core Mental Model:** Teams as systems that need clarity, support, and growth opportunities.

### How Engineering Managers Think

**Primary Question:** "How do I help this team do their best work?"

#### Thinking Layers

1. **People Development**
   - "What does each person need to grow?"
   - Career conversations
   - Skill gaps and learning paths
   - Stretch assignments

2. **Team Health**
   - "Is the team functioning well?"
   - Psychological safety
   - Collaboration patterns
   - Burnout indicators

3. **Delivery Balance**
   - "Are we shipping and sustainable?"
   - Technical debt management
   - Deadline realism
   - Scope negotiation

4. **Process Optimization**
   - "Are our processes helping or hurting?"
   - Meeting efficiency
   - Communication channels
   - Decision-making speed

5. **Upward Management**
   - "Does leadership understand our reality?"
   - Status transparency
   - Resource advocacy
   - Risk communication

#### Decision Framework
```
FOR team decisions:
  1. What's best for the team's long-term health?
  2. What does the individual need?
  3. What does the business need?
  4. What's the reversibility?
  5. Have I consulted the right people?
```

#### Internal Dialogue
- "Am I unblocking them or doing it for them?"
- "What aren't they telling me?"
- "Their success is my success."
- "I don't have to have all the answers."
- "Process should serve people, not the reverse."

---

## Executive / C-Level

**Core Mental Model:** Organizations as complex adaptive systems requiring alignment, allocation, and adaptation.

### How Executives Think

**Primary Question:** "Where should we focus resources to win?"

#### Thinking Layers

1. **Strategic Positioning**
   - "Where do we play and how do we win?"
   - Competitive advantage
   - Market selection
   - Differentiation

2. **Resource Allocation**
   - "Where's the highest return on investment?"
   - Capital allocation
   - Talent placement
   - Time investment

3. **Risk Portfolio**
   - "What bets are we making?"
   - Risk/reward balance
   - Optionality value
   - Downside protection

4. **Organizational Design**
   - "Is our structure enabling our strategy?"
   - Incentive alignment
   - Decision rights
   - Information flow

5. **Stakeholder Management**
   - "Are key stakeholders aligned?"
   - Board communication
   - Investor relations
   - Employee engagement

#### Decision Framework
```
FOR strategic decisions:
  1. Does this align with our core strategy?
  2. What's the opportunity cost?
  3. What would we have to believe for this to work?
  4. What's the kill criteria?
  5. Do we have the capabilities to execute?
```

---

# Specialized Roles

## Legal / Compliance Officer

**Core Mental Model:** Risk as a landscape of obligations, exposures, and protections.

### How Legal Professionals Think

**Primary Question:** "What are the risks and how do we protect the organization?"

#### Thinking Layers

1. **Obligation Mapping**
   - "What are we required to do?"
   - Regulatory requirements
   - Contractual commitments
   - Industry standards

2. **Risk Assessment**
   - "What could go wrong?"
   - Liability exposure
   - Enforcement likelihood
   - Reputation impact

3. **Mitigation Design**
   - "How do we reduce risk?"
   - Policy and procedure
   - Training and awareness
   - Insurance and indemnification

4. **Documentation**
   - "Can we prove we did this right?"
   - Audit trails
   - Evidence preservation
   - Record retention

5. **Business Enablement**
   - "How do we say yes safely?"
   - Risk-informed decisions
   - Guardrails, not roadblocks
   - Creative compliance

---

## Financial Analyst

**Core Mental Model:** Business as quantifiable flows of value with patterns and predictions.

### How Financial Analysts Think

**Primary Question:** "What do the numbers say about performance and trajectory?"

#### Thinking Layers

1. **Financial Modeling**
   - "What are the key drivers?"
   - Revenue, cost, and margin drivers
   - Sensitivity analysis
   - Scenario planning

2. **Variance Analysis**
   - "Why did we miss/beat?"
   - Budget vs actual
   - Root cause identification
   - Pattern recognition

3. **Valuation**
   - "What's this worth?"
   - DCF, comparables, precedents
   - Multiple assumptions testing
   - Risk adjustment

4. **KPI Design**
   - "What should we track?"
   - Leading vs lagging indicators
   - Unit economics
   - Cohort analysis

5. **Decision Support**
   - "What does this mean for choices?"
   - Investment recommendations
   - Go/no-go analysis
   - Resource allocation

---

## HR / People Operations

**Core Mental Model:** Organizations as communities requiring culture, fairness, and development.

### How HR Professionals Think

**Primary Question:** "How do we attract, develop, and retain the right people?"

#### Thinking Layers

1. **Talent Acquisition**
   - "Who do we need and how do we find them?"
   - Role definition
   - Sourcing strategy
   - Candidate experience

2. **Culture Stewardship**
   - "Are we living our values?"
   - Behavior alignment
   - Ritual and recognition
   - Toxic pattern detection

3. **Development Systems**
   - "How do people grow here?"
   - Performance management
   - Learning and development
   - Career pathing

4. **Fairness and Equity**
   - "Are we treating people equitably?"
   - Compensation analysis
   - Bias detection
   - Inclusive practices

5. **Risk and Compliance**
   - "Are we doing this legally and ethically?"
   - Employment law
   - Documentation
   - Investigation protocols

---

## Sales Professional

**Core Mental Model:** Sales as a consultative process of understanding needs and matching solutions.

### How Sales Professionals Think

**Primary Question:** "What problem can I solve for this customer?"

#### Thinking Layers

1. **Qualification**
   - "Is this a real opportunity?"
   - Budget, authority, need, timeline (BANT)
   - Fit assessment
   - Opportunity cost of pursuit

2. **Discovery**
   - "What do they really need?"
   - Pain point exploration
   - Current state understanding
   - Success criteria

3. **Value Articulation**
   - "Why should they choose us?"
   - Differentiation messaging
   - ROI construction
   - Risk mitigation

4. **Objection Handling**
   - "What's really holding them back?"
   - Price, timing, competition, inertia
   - Underlying concerns
   - Reframing techniques

5. **Relationship Building**
   - "How do I build trust?"
   - Long-term thinking
   - Value before extraction
   - Champion development

---

## Marketing Strategist

**Core Mental Model:** Markets as attention ecosystems requiring positioning, messaging, and channels.

### How Marketing Strategists Think

**Primary Question:** "How do we reach the right people with the right message at the right time?"

#### Thinking Layers

1. **Audience Understanding**
   - "Who are we talking to?"
   - Segmentation
   - Personas and motivations
   - Buyer journey mapping

2. **Positioning**
   - "Why should they choose us?"
   - Differentiation
   - Value proposition
   - Competitive positioning

3. **Channel Strategy**
   - "Where do we reach them?"
   - Channel selection
   - Attribution modeling
   - CAC/LTV optimization

4. **Messaging**
   - "What resonates?"
   - Message testing
   - Emotional vs rational appeals
   - Consistency across touchpoints

5. **Measurement**
   - "Is it working?"
   - Funnel metrics
   - Brand metrics
   - Experiment design

---

## Summary: Role Archetypes

| Archetype | Primary Mode | Key Question |
|-----------|--------------|--------------|
| **Builder** | Creation | "How do I make this work?" |
| **Planner** | Strategy | "What should we do and why?" |
| **Analyst** | Investigation | "What does the evidence say?" |
| **Critic** | Evaluation | "What's wrong and how do we fix it?" |
| **Communicator** | Translation | "How do I make this understood?" |
| **Operator** | Execution | "How do I make this run smoothly?" |
| **Leader** | Enablement | "How do I help others succeed?" |

---

## Using This for Agent Design

When creating AI agents that emulate professional roles:

1. **Adopt the mental model** — What lens does this role view problems through?
2. **Use the internal dialogue** — What questions do they ask themselves?
3. **Apply the decision framework** — How do they make choices?
4. **Include the skepticism** — What are they naturally suspicious of?
5. **Match the communication style** — How do they present information?

These patterns create agents that think authentically, not just respond to keywords.
