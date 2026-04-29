export type Declaration =
  | EntityDeclaration
  | EnumDeclaration
  | EventDeclaration
  | QueryDeclaration
  | QueryFragmentDeclaration
  | SimulationDeclaration
  | TransactionDeclaration
  | TransitionDeclaration;

export interface Program {
  moduleName: string;
  declarations: Declaration[];
}

export interface EntityDeclaration {
  kind: "entity";
  name: string;
  fields: FieldDeclaration[];
  indexes: IndexDeclaration[];
}

export interface FieldDeclaration {
  name: string;
  type: TypeRef;
  attributes: FieldAttributes;
  source: string;
}

export interface FieldAttributes {
  primary: boolean;
  generated: boolean;
  required: boolean;
  unique: boolean;
  defaultValue?: string;
  check?: string;
}

export interface IndexDeclaration {
  name: string;
  fields: IndexField[];
}

export interface IndexField {
  name: string;
  direction?: "asc" | "desc";
}

export interface EnumDeclaration {
  kind: "enum";
  name: string;
  values: string[];
}

export interface EventDeclaration {
  kind: "event";
  name: string;
  fields: FieldDeclaration[];
}

export interface QueryDeclaration {
  kind: "query";
  name: string;
  parameters: QueryParameter[];
  resultType: string;
  body: QueryBody;
}

export interface QueryFragmentDeclaration {
  kind: "queryFragment";
  name: string;
  rangeName: string;
  sourceEntity: string;
  where: string;
}

export interface SimulationDeclaration {
  kind: "simulation";
  name: string;
  assumptions: SimulationAssumption[];
  formulas: SimulationFormula[];
  scenarios: SimulationScenario[];
  changes: SimulationChange[];
  forecast: SimulationForecast;
}

export interface SimulationAssumption {
  name: string;
  value: string;
}

export interface SimulationFormula {
  name: string;
  expression: string;
}

export interface SimulationScenario {
  name: string;
  overrides: SimulationAssumption[];
  changes: SimulationChange[];
}

export interface SimulationChange {
  period: number;
  unit: "day" | "week" | "month" | "quarter" | "year";
  overrides: SimulationAssumption[];
}

export interface SimulationForecast {
  periods: number;
  unit: "day" | "week" | "month" | "quarter" | "year";
}

export interface TransactionDeclaration {
  kind: "transaction";
  name: string;
  parameters: QueryParameter[];
  writes: string[];
  retry?: {
    attempts: number;
  };
  body: string;
}

export interface TransitionDeclaration {
  kind: "transition";
  entity: string;
  field: string;
  rules: TransitionRuleDeclaration[];
}

export interface TransitionRuleDeclaration {
  from: string;
  to: string;
}

export interface QueryParameter {
  name: string;
  type: TypeRef;
}

export interface QueryBody {
  rangeName: string;
  sourceEntity: string;
  joins: QueryJoin[];
  fragments: string[];
  where?: string;
  after?: string;
  groupBy: string[];
  orderBy?: {
    expression: string;
    direction: "asc" | "desc";
  };
  limit?: string;
  select: QueryProjection;
}

export interface QueryJoin {
  kind: "inner" | "left";
  rangeName: string;
  sourceEntity: string;
  on: string;
}

export type QueryProjection =
  | { kind: "entity"; expression: string }
  | { kind: "record"; fields: QueryProjectionField[] };

export interface QueryProjectionField {
  name: string;
  expression: string;
}

export interface TypeRef {
  name: string;
  optional: boolean;
  args: TypeRef[];
  raw: string;
}
