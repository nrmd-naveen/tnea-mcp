# TNEA Choice Filling MCP Server

An MCP (Model Context Protocol) server that automates the Tamil Nadu Engineering Admissions choice filling process. Instead of manually researching thousands of college-course combinations, this server generates optimized choices based on historical cutoffs and real-time seat availability.

## What It Does

- **Fetches live data** from TNEA portal (3,500+ seats across 200+ colleges)
- **Analyzes historical cutoffs** to predict admission chances
- **Generates smart choice lists** (400+ options) based on your preferences
- **Submits choices directly** to the official TNEA portal

## Setup

### 1. Install Dependencies
```bash
npm install
```


### 4. Run the Server
```bash
npm start
```

The MCP server will start on the default port and be ready to connect with Claude or other MCP-compatible clients.

### 5. Connect to Claude
Add to your Claude MCP configuration:
```json
{
  "servers": {
    "tnea-choice-filling": {
      "command": "node",
      "args": ["path/to/server.js"]
    }
  }
}
```

## Available Tools

### `tnea-choice-filling:login`
Authenticate with TNEA portal
```json
{
  "email": "string",
  "password": "string"
}
```

### `tnea-choice-filling:get_available_seats`
Fetch current seat matrix
```json
{}
```

### `tnea-choice-filling:load_cutoff_data`
Load historical cutoff data
```json
{
  "cutoffFilePath": "string (optional, default: ./data/2024cutoff.json)"
}
```

### `tnea-choice-filling:load_course_preferences`
Load preferred courses list
```json
{
  "coursesFilePath": "string (optional, default: ./data/preferred_courses.json)"
}
```

### `tnea-choice-filling:generate_choices`
Generate optimized choice list
```json
{
  "category": "string (OC|BC|BCM|MBC|SC|SCA|ST, default: MBC)",
  "districtChoices": "array of strings (required)",
  "minCutoff": "number (default: 85)",
  "topPrefDist": "array of strings (optional)"
}
```

### `tnea-choice-filling:submit_choices`
Submit choices to TNEA portal
```json
{
  "selections": "array of seat ID strings (required)"
}
```

### `tnea-choice-filling:get_session_status`
Check current session status
```json
{}
```

## Usage with Claude

Once connected, you can ask Claude to:
- Generate choice lists: "Generate TNEA choices for MBC category in Chennai"
- Submit choices: "Submit these 10 choices to TNEA"
- Analyze data: "Show me available seats in Computer Science"

## Data Files Required

Place these in your `./data/` directory:
- `2024cutoff.json` - Historical cutoff data
- `preferred_courses.json` - List of preferred engineering courses

## Requirements

- Node.js 16+
- Valid TNEA credentials during choice filling period
- Internet connection for portal access
