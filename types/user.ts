import { v4 as uuidv4 } from "uuid";
import { Feature } from "./feature";
export class User {
  id: string;
  name: string;
  email: string;

  constructor(id: string, username: string, email: string) {
    this.id = id || uuidv4();
    this.name = username;
    this.email = email;
  }
}

// export class Agent extends User {
//   url: string;
//   features: [Feature];

//   constructor(
//     agentId: string,
//     agentName: string,
//     agentEmail: string,
//     url: string,
//     features: [Feature]
//   ) {
//     super(agentId, agentName, agentEmail);
//     this.url = url;
//     this.features = features;
//   }
// }

export interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
}
