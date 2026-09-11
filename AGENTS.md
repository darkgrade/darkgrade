# Project Cheat Sheet

## Tech Stack:

- TypeScript only (never JS)
- Bun/bunx for runtime, tsx for execution
- Vite for serving, Vitest for testing
- React for UIs

## Code Organization:

- Vendor code goes in src/vendors/ only
- No vendor logic in core/transport layers
- Keep package.json scripts clean and complete
- Always use import aliases ("@core/ptp-protocol/<>"), never use relative (from "../../<>") imports

## Development Process:

- Use available tools (notes, memory, MCP)
- Build real solutions, no mocks/stubs
- Only create notes after confirming features work
- Stay honest about what's actually working
- If a script or test that is close to what we need already exists modify, don't create more crap

## Commands:

- Everything runnable via npm scripts
- Easy setup and execution

# Software Engineering Principles for Agents

**Core Philosophy**: Prioritize readability and maintainability over premature optimization. Code is written for humans to understand.

## 1. Composition Over Inheritance

- Use dependency injection and interfaces instead of class hierarchies
- Replace abstract base classes with interfaces
- Move shared functionality to separate, composable classes
- Design for change - avoid tight coupling that breaks when requirements evolve

## 2. Abstraction

- Only abstract when value exceeds coupling cost
- Wait for 3+ similar implementations before abstracting
- Don't abstract single duplicate lines or simple variable assignments
- Use lightweight interfaces over heavyweight parent classes

## 3. Naming

- Never abbreviate - write full words
- Never use single letters (except short loop counters)
- Include units in variable names (`delaySeconds`)
- Avoid "Helper", "Utils", "Base", "Abstract" in class names
- If struggling to name something, restructure the code

## 4. Code Structure

- Maximum 3 levels of indentation per function
- Use early returns and guard clauses instead of deep nesting
- Extract complex logic into well-named functions
- One responsibility per function

## 5. Comments

- Replace comments with better code whenever possible
- Use meaningful variable names instead of explaining unclear code
- Only comment for: performance reasons, mathematical algorithms, API documentation
- Write API documentation, not implementation comments

## 6. Performance

- Measure before optimizing
- Focus on data structure selection over micro-optimizations
- Solve the real problem first, optimize later
- Avoid debates about `++i` vs `i++` unless proven critical
- Use profilers to identify actual bottlenecks

## 7. Dependency Injection

- Pass dependencies instead of creating them directly
- Use interfaces to define contracts
- Enables configurable, testable systems
- Inject mocks and fakes for isolated testing

## Decision Framework

When evaluating code changes, ask:

1. Does this make the code more readable?
2. Does this reduce coupling?
3. Does this make testing easier?
4. Is this solving a real problem or theoretical one?

## Red Flags

- Deep inheritance hierarchies
- Utility classes with mixed responsibilities
- Premature performance optimizations
- Comments explaining complex code
- Excessive nesting
- Abbreviations

## Priority Order

1. Solve the business problem correctly
2. Make code readable and maintainable
3. Ensure code is testable
4. Optimize only when measured as necessary
