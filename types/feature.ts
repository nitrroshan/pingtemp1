export class Feature {
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
