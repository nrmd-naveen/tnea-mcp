// src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
const fs = require('fs/promises');
import path from 'path';
import ts from 'typescript';

interface LoginResponse {
  status: string;
  sessionId: string;
  userId: string;
  name: string;
}

interface SeatData {
  _id: string;
  feeCode: string;
  allotSeq: number;
  colCode: string;
  colName: string;
  branCode: string;
  branName: string;
  OC: number;
  BCM: number;
  BC: number;
  MBC: number;
  SCA: number;
  SC: number;
  ST: number;
}

interface CutoffData {
  _id: string;
  coc: number;
  con: string;
  brc: string;
  brn: string;
  code: string;
  OC: string | number;
  BC: string | number;
  BCM: string | number;
  MBC: string | number;
  SC: string | number;
  SCA: string | number;
  ST: string | number;
}

interface Course {
  branCode: string;
  branName: string;
}

interface ValidSelection {
  id: string;
  college: string;
  branch: string;
  cutoff: number;
}

interface GenerateChoicesArgs {
  districtChoices: string[];
  topPrefDist?: string[];
  minCutoff?: number;
  category?: 'OC' | 'BC' | 'BCM' | 'MBC' | 'SC' | 'SCA' | 'ST';
}

class TNEAMCPServer {
  private server: Server;
  private sessionId: string | null = null;
  private seatMatrix: SeatData[] = [];
  private cutoffData: CutoffData[] = [];
  private preferredCourses: Course[] = [];

  constructor() {
    this.server = new Server({
      name: 'tnea-choice-filling-server',
      version: '1.0.0',
      description: 'MCP Server for TNEA Choice Filling Automation'
    }, {
      capabilities: {
        tools: {},
      },
    });

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'login',
            description: 'Login to TNEA portal and get session ID',
            inputSchema: {
              type: 'object',
              properties: {
                email: { type: 'string', description: 'Login email/username' },
                password: { type: 'string', description: 'Password' }
              },
              required: ['email', 'password'],
            },
          },
          {
            name: 'get_available_seats',
            description: 'Fetch current seat matrix from TNEA portal',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'load_cutoff_data',
            description: 'Load historical cutoff data from file',
            inputSchema: {
              type: 'object',
              properties: {
                cutoffFilePath: { 
                  type: 'string', 
                  description: 'Path to cutoff JSON file',
                  default: './data/2024cutoff.json'
                }
              },
            },
          },
          {
            name: 'load_course_preferences',
            description: 'Load preferred courses from file',
            inputSchema: {
              type: 'object',
              properties: {
                coursesFilePath: { 
                  type: 'string', 
                  description: 'Path to courses JSON file',
                  default: './data/preferred_courses.json'
                }
              },
            },
          },
          {
            name: 'generate_choices',
            description: 'Generate choice list based on preferences and cutoffs',
            inputSchema: {
              type: 'object',
              properties: {
                districtChoices: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of preferred districts'
                },
                topPrefDist: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Top priority districts'
                },
                minCutoff: {
                  type: 'number',
                  description: 'Minimum cutoff score to consider',
                  default: 85
                },
                category: {
                  type: 'string',
                  enum: ['OC', 'BC', 'BCM', 'MBC', 'SC', 'SCA', 'ST'],
                  description: 'Student category for seat availability',
                  default: 'MBC'
                }
              },
              required: ['districtChoices'],
            },
          },
          {
            name: 'submit_choices',
            description: 'Submit generated choices to TNEA portal',
            inputSchema: {
              type: 'object',
              properties: {
                selections: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of seat IDs to submit'
                }
              },
              required: ['selections'],
            },
          },
          {
            name: 'get_session_status',
            description: 'Check current session status',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'login':
            if (!args || typeof args.email !== 'string' || typeof args.password !== 'string') {
              throw new McpError(ErrorCode.InvalidParams, 'Login requires email and password');
            }
            return await this.handleLogin(args.email, args.password);

          case 'get_available_seats':
            return await this.handleGetAvailableSeats();

          case 'load_cutoff_data':
            // const cutoffPath = args?.cutoffFilePath || './data/2024cutoff.json';
            const cutoffPath =  './data/2024cutoff.json';
            return await this.handleLoadCutoffData(cutoffPath);

          case 'load_course_preferences':
            // const coursesPath = args?.coursesFilePath || './data/preferred_courses.json';
            const coursesPath = './data/preferred_courses.json';
            return await this.handleLoadCoursePreferences(coursesPath);

          case 'generate_choices':
            if (!args) {
              throw new McpError(ErrorCode.InvalidParams, 'Generate choices requires parameters');
                }
                //@ts-ignore
            return await this.handleGenerateChoices(args);

          case 'submit_choices':
            if (!args || !Array.isArray(args.selections)) {
              throw new McpError(ErrorCode.InvalidParams, 'Submit choices requires selections array');
            }
            return await this.handleSubmitChoices(args.selections);

          case 'get_session_status':
            return await this.handleGetSessionStatus();

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new McpError(ErrorCode.InternalError, `Error executing tool ${name}: ${errorMessage}`);
      }
    });
  }

  private async handleLogin(email: string, password: string) {
    try {
      const response = await fetch("https://www.tneaonline.org/api/users/login", {
        headers: {
          "accept": "application/json",
          "accept-language": "en-US,en;q=0.9",
          "content-type": "application/json; charset=utf-8",
          "sessionid": "null",
          "Referer": "https://www.tneaonline.org/user/login"
        },
        body: JSON.stringify({
          "loginName": email,
          "password": password
        }),
        method: "POST"
      });

      const data: LoginResponse = await response.json();
      
      if (data.sessionId) {
        this.sessionId = data.sessionId;
        return {
          content: [{
            type: 'text',
            text: `✅ Login successful! Welcome ${data.name}\nSession ID: ${data.sessionId}`
          }]
        };
      } else {
        throw new Error("Invalid login credentials");
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Login failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }

  private async handleGetAvailableSeats() {
    if (!this.sessionId) {
      throw new Error("Not logged in. Please login first.");
    }

    try {
      const response = await fetch("https://www.tneaonline.org/api/api/users/seatmatrix", {
        headers: {
          "accept": "*/*",
          "sessionid": this.sessionId,
          "cookie": `sessionId=${this.sessionId}`,
          "Referer": "https://www.tneaonline.org/u/choice"
        },
        method: "GET"
      });

      const data: SeatData[] = await response.json();
      this.seatMatrix = data;

      // Save to file for reference
      await fs.writeFile("available_seats.json", JSON.stringify(data, null, 2));

      const availableSeats = data.filter(seat => 
        seat.OC > 0 || seat.BC > 0 || seat.BCM > 0 || seat.MBC > 0 || seat.SC > 0 || seat.SCA > 0 || seat.ST > 0
      ).length;

      return {
        content: [{
          type: 'text',
          text: `✅ Fetched ${data.length} total seats, ${availableSeats} have availability\nData saved to available_seats.json`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Failed to fetch seat matrix: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }

  private async handleLoadCutoffData(filePath: string) {
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      this.cutoffData = JSON.parse(data);
      
      return {
        content: [{
          type: 'text',
          text: `✅ Loaded ${this.cutoffData.length} cutoff records from ${filePath}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Failed to load cutoff data: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }

  private async handleLoadCoursePreferences(filePath: string) {
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      this.preferredCourses = JSON.parse(data);
      
      return {
        content: [{
          type: 'text',
          text: `✅ Loaded ${this.preferredCourses.length} preferred courses from ${filePath}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Failed to load course preferences: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }

  private async handleGenerateChoices(args: GenerateChoicesArgs) {
    if (this.seatMatrix.length === 0) {
      throw new Error("Seat matrix not loaded. Please fetch available seats first.");
    }
    if (this.cutoffData.length === 0) {
      throw new Error("Cutoff data not loaded. Please load cutoff data first.");
    }
    if (this.preferredCourses.length === 0) {
      throw new Error("Course preferences not loaded. Please load course preferences first.");
    }
    if (!args.districtChoices || !Array.isArray(args.districtChoices)) {
      throw new Error("districtChoices is required and must be an array");
    }

    const {
      districtChoices,
      topPrefDist = [],
      minCutoff = 85,
      category = 'MBC'
    } = args;

    const result = this.generateSelectionPayload(districtChoices, topPrefDist, minCutoff, category);

    return {
      content: [{
        type: 'text',
        text: `✅ Generated ${result.selections.length} choices\n\nTop 10 choices:\n${result.reference.slice(0, 10).map((ref, idx) => 
          `${idx + 1}. ${ref.college}\n   ${ref.branch} (Cutoff: ${ref.cutoff})`
        ).join('\n\n')}\n\n${result.selections.length > 10 ? '... and ' + (result.selections.length - 10) + ' more' : ''}`
      }]
    };
  }

  private generateSelectionPayload(districtChoices: string[], topPrefDist: string[], minCutoff: number, category: string) {
    const allowedBranchCodes = new Set(this.preferredCourses.map(course => course.branCode));
    const validSelections: ValidSelection[] = [];
    let unMatched = 0;
    const withoutCutoff: string[] = [];

    for (const seat of this.seatMatrix) {
      const { [category as keyof SeatData]: categorySeats, colCode, branCode, _id, colName, branName } = seat;

      if (!allowedBranchCodes.has(branCode)) continue;
      if (typeof categorySeats !== 'number' || categorySeats <= 0) {
        continue;
      }

      // Try to find exact cutoff
      let matchingCutoff = this.cutoffData.find(
        c => String(c.coc) === String(colCode) && c.brc === branCode
      );

      // If not found, fallback to CS branch in same college
      if (!matchingCutoff) {
        matchingCutoff = this.cutoffData.find(
          c => String(c.coc) === String(colCode) && c.brc === "CS"
        );
      }

      if (matchingCutoff) {
        let cutoffScore = parseFloat(String(matchingCutoff[category as keyof CutoffData])) || 
                          parseFloat(String(matchingCutoff.OC));
        
        if (isNaN(cutoffScore)) {
          if (!withoutCutoff.includes(colName)) {
            withoutCutoff.push(colName);
          }
          continue;
        }

        validSelections.push({
          id: _id,
          college: colName,
          branch: branName,
          cutoff: cutoffScore,
        });
      } else {
        unMatched++;
      }
    }

    // Sort by cutoff (higher cutoff = better college/course)
    const sorted = validSelections.sort((a, b) => b.cutoff - a.cutoff);

    // Normalize for case-insensitive matching
    const normalize = (str: string) => str?.toLowerCase();

    // Filter by preferred districts
    const filteredByDistrict = sorted.filter(item =>
      districtChoices.some(dist => normalize(item.college).includes(normalize(dist)))
    );

    // Prioritize top preferred districts with cutoff > minCutoff
    const topPreferredHighCutoff: ValidSelection[] = [];
    const others: ValidSelection[] = [];

    for (const item of filteredByDistrict) {
      const isTopDist = topPrefDist.some(dist => normalize(item.college).includes(normalize(dist)));
      if (isTopDist && item.cutoff > minCutoff) {
        topPreferredHighCutoff.push(item);
      } else {
        others.push(item);
      }
    }

    // Combine: top preferred first, then others
    const finalSorted = [...topPreferredHighCutoff, ...others];

    const selections = finalSorted.map(item => item.id);
    const reference = finalSorted.map(item => ({
      college: item.college,
      branch: item.branch,
      cutoff: item.cutoff,
    }));

    return { selections, reference };
  }

  private async handleSubmitChoices(selections: string[]) {
    if (!this.sessionId) {
      throw new Error("Not logged in. Please login first.");
    }

    try {
      const response = await fetch("https://www.tneaonline.org/api/api/users/selection", {
        method: "PUT",
        headers: {
          "accept": "application/json",
          "content-type": "application/json; charset=utf-8",
          "sessionid": this.sessionId,
          "cookie": `sessionId=${this.sessionId}`,
          "Referer": "https://www.tneaonline.org/u/choice"
        },
        body: JSON.stringify({ selections })
      });

      const result = await response.json();
      
      return {
        content: [{
          type: 'text',
          text: `✅ Choices submitted successfully!\nSubmitted ${selections.length} choices\nResponse: ${JSON.stringify(result, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Failed to submit choices: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }

  private async handleGetSessionStatus() {
    return {
      content: [{
        type: 'text',
        text: `Session Status: ${this.sessionId ? '✅ Active' : '❌ Not logged in'}\n` +
              `Seat Matrix: ${this.seatMatrix.length} records loaded\n` +
              `Cutoff Data: ${this.cutoffData.length} records loaded\n` +
              `Course Preferences: ${this.preferredCourses.length} courses loaded`
      }]
    };
  }

  private setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('TNEA Choice Filling MCP server running on stdio');
  }
}

// Start the server
async function main() {
  const server = new TNEAMCPServer();
  await server.run();
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});