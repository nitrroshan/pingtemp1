; Ruby tag queries
; Based on Aider's tree-sitter-language-pack

; Methods
(method
  name: (_) @name.definition.method) @definition.method

(singleton_method
  name: (_) @name.definition.method) @definition.method

; Classes
(class
  name: (constant) @name.definition.class) @definition.class

(singleton_class
  value: (constant) @name.definition.class) @definition.class

; Modules
(module
  name: (constant) @name.definition.module) @definition.module

; === References ===

(call
  method: (identifier) @name.reference.call) @reference.call
