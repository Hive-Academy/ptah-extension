# Task Context: Ptah Extension Landing Page

## 📋 Task Information

- **ID**: TASK_2025_038
- **Type**: FEATURE (New Application)
- **Complexity**: High
- **Created**: 2025-12-02

## 🎯 User Intent

The user wants to create a dedicated landing page for the Ptah Extension to showcase its capabilities, specifically enhancing Claude Code with an Egyptian-themed, powerful VS Code interface.

## 🛠️ Technical Requirements

1. **Framework**: Angular (latest) within the existing Nx workspace.
2. **UI Library**: DaisyUI (Tailwind CSS plugin) for styling.
3. **Animation/Graphics**: Three.js and GSAP for high-end visual effects.
4. **Hosting**: Published to GitHub Pages.
5. **Key Features**:
   - **Live Demo**: Utilize the existing Angular/DaisyUI chat library to render a chat session.
   - **Data Source**: Load a local JSON file (e.g., `#file:test-sessions-anubis`) to simulate a real session.
   - **Content**:
     - Present Claude Code as an awesome tool.
     - Show Ptah as "Egyptian-styled power-ups" for VS Code.
     - Highlight `workspace-intelligence` and `vscode-lm-tools` features.
   - **Visual Style**: Slick UI, Egyptian theme, "power-up" aesthetic.

## 📝 Conversation Summary

The user provided a specific direction to build a new Nx app that serves as a landing page. They emphasized the need to "show off" the tool using the actual chat components from the project, populated with sample data. This requires understanding the current codebase to reuse components effectively.

## 📂 Attachments

- `test-sessions-anubis/`: Folder containing sample JSONL session files to be used for the live demo.

## 🚀 Execution Strategy

1. **Phase 1: Project Manager**: Define detailed requirements, site structure, and content strategy.
2. **Phase 2: Researcher**: Investigate Three.js/GSAP integration in Angular, GitHub Pages deployment for Nx, and component reuse strategy.
3. **Phase 3: UI/UX Designer**: Create visual specifications, Egyptian theme assets, and animation concepts.
4. **Phase 4: Software Architect**: Design the application structure, component integration (shared-ui), and data loading mechanism.
5. **Phase 5: Team Leader**: Break down implementation into tasks (setup, components, integration, content, deployment).
6. **Phase 6: QA/Review**: Verify functionality, visual fidelity, and deployment.
