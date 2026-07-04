<div align="center">

# BOT-WHATSAPP

### WhatsApp Bot with AI Integration

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Docker Compose](https://img.shields.io/badge/Docker_Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)

</div>

---

## About

A full stack WhatsApp bot with AI capabilities, designed for automated customer service and intelligent interactions. Built with a modular architecture using Docker Compose for easy scaling and deployment.

## Features

- **Automated Responses** — AI-powered intelligent conversation handling
- **Full Stack Architecture** — Separate frontend and backend services
- **Docker Compose** — Multi-service orchestration
- **Scalable** — Easy to add new features and capabilities

## Architecture

```
BOT-WHATSAPP/
├── backend/          # Node.js API server
├── frontend/         # Web interface
├── docker-compose.yml
└── .dockerignore
```

## Getting Started

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- WhatsApp Business API credentials

### Installation

```bash
# Clone the repository
git clone https://github.com/Joker8-h/BOT-WHATSAPP.git
cd BOT-WHATSAPP

# Start with Docker Compose
docker-compose up -d

# Or run locally
cd backend
npm install
npm start
```

### Environment Variables

```env
WHATSAPP_TOKEN=your_token
WHATSAPP_PHONE_ID=your_phone_id
PORT=3000
```

---

<div align="center">

[![View Repository](https://img.shields.io/badge/View-Repository-0d1117?style=for-the-badge&logo=github)](https://github.com/Joker8-h/BOT-WHATSAPP)

</div>
