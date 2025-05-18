import { v4 as uuidv4 } from "uuid";

export class User {
  id: string;
  username: string;
  email: string;

  constructor(id: string, username: string, email: string) {
    this.id = id || uuidv4();
    this.username = username;
    this.email = email;
  }
}
class Feature {
  featureName: string;
  featureDescription: string;
  inputPrototype: string;
  outputPrototype: string;
  constructor(
    featureName: string,
    featureDescription: string,
    inputPrototype: string,
    outputPrototype: string
  ) {
    this.featureName = featureName;
    this.featureDescription = featureDescription;
    this.inputPrototype = inputPrototype;
    this.outputPrototype = outputPrototype;
  }
}
export class Agent extends User {
  url: string;
  features: [Feature];

  constructor(
    agentId: string,
    agentName: string,
    agentEmail: string,
    url: string,
    features: [Feature]
  ) {
    super(agentId, agentName, agentEmail);
    this.url = url;
    this.features = features;
  }
}
