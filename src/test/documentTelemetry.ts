'use strict';

import { readFileSync } from 'fs';
import * as glob from 'glob';
import * as ts from 'typescript';
import { getNamesAndValues } from '../client/common/utils/enum';

const compilerOptions: ts.CompilerOptions = {
    baseUrl: '.',
    paths: { '*': ['types/*'] },
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2018,
    outDir: 'out',
    lib: [
        'es6',
        'es2018',
        'dom'
    ],
    // jsx: 'react',
    sourceMap: true,
    rootDir: 'src',
    experimentalDecorators: true,
    allowSyntheticDefaultImports: true,
    strict: true,
    noImplicitAny: true,
    noImplicitThis: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    // We don't worry about this one:
    //"noImplicitReturns": true,
    noFallthroughCasesInSwitch: true

}
// const options = {
//     compilerOptions,
//     exclude: [
//         'node_modules',
//         '.vscode-test',
//         '.vscode test',
//         'src/server/node_modules',
//         'src/client/node_modules',
//         'src/server/src/typings',
//         'src/client/src/typings',
//         'build'
//     ]
// };
const filePath = '/Users/donjayamanne/Desktop/development/vscode/pythonVSCode/src/client/telemetry/index.ts';

const kinds = getNamesAndValues<ts.SyntaxKind>(ts.SyntaxKind);
const files = glob.sync('/Users/donjayamanne/Desktop/development/vscode/pythonVSCode/src/client/**/*.ts');
const program = ts.createProgram({ options: compilerOptions, rootNames: files });

function fileExists(fileName: string): boolean {
    return ts.sys.fileExists(fileName);
}

function readFile(fileName: string): string | undefined {
    return ts.sys.readFile(fileName);
}

console.log(files.length);
console.log(program.getSourceFiles().length);
const m = ts.resolveModuleName('./constants', '/Users/donjayamanne/Desktop/development/vscode/pythonVSCode/src/client/telemetry/index.ts', compilerOptions, {
    fileExists,
    readFile
});
console.log(m);
// program.
function getSyntaxKind(kind: ts.SyntaxKind): {
    name: string;
    value: ts.SyntaxKind;
} {
    return kinds.find(item => item.value === kind)!;
}

function printSytaxKind(kind: ts.SyntaxKind) {
    console.log(getSyntaxKind(kind));
}

function getTelemetryDeclaration(sourceFile: ts.SourceFile): ts.InterfaceDeclaration {
    return sourceFile.statements
        .find(item => item.kind === ts.SyntaxKind.InterfaceDeclaration && (item as ts.InterfaceDeclaration).name.text === 'IEventNamePropertyMapping')! as ts.InterfaceDeclaration;
}

type ImportIdentifier = ts.Expression;
type VariableIdentifier = {};
type Identifier = ImportIdentifier | VariableIdentifier;

function gatherIdentifiers(sourceFile: ts.SourceFile): Map<string, Identifier> {
    const dict = new Map<string, Identifier>();
    gatherImportIdentifiers(sourceFile, dict);
    gatherVariableIdentifiers(sourceFile, dict);
    return dict;
}
function gatherVariableIdentifiers(_sourceFile: ts.SourceFile, _dict: Map<string, Identifier>) {
    return;
}
function gatherImportIdentifiers(sourceFile: ts.SourceFile, dict: Map<string, Identifier>) {
    function processImports(imports: ts.Node, moduleSpecifier: ts.Expression) {
        switch (imports.kind) {
            case ts.SyntaxKind.NamedImports: {
                imports.forEachChild(c => processImports(c, moduleSpecifier));
                break;
            }
            case ts.SyntaxKind.Identifier: {
                dict.set(imports.getText(), moduleSpecifier);
                break;
            }
            case ts.SyntaxKind.ImportSpecifier: {
                switch (imports.getChildCount()) {
                    case 1: {
                        // Assume this is a default import or a * import.
                        dict.set(imports.getText(), moduleSpecifier);
                        break;
                    }
                    case 3: {
                        // Assumed this is an import with an alias.
                        dict.set(imports.getChildAt(2).getText(), moduleSpecifier);
                        break;
                    }
                    default: {
                        throw new Error('Unknown import syntax');
                    }
                }
                break;
            }
            default: {
                return;
            }
        }
    }
    sourceFile.statements.forEach(statement => {
        if (!ts.isImportDeclaration(statement)) {
            return;
        }
        const declaration = statement as ts.ImportDeclaration;
        if (!declaration.importClause) {
            return;
        }
        declaration.importClause.forEachChild(imp => {
            processImports(imp, declaration.moduleSpecifier);
        });
        // switch (declaration.importClause
        console.log(declaration.pos);
    });
}

function evaluateExpression(expression: ts.Expression, sourceFile: ts.SourceFile): string {
    console.log(`Evaluate Expression ${expression.getText()}`);
    switch (expression.kind) {
        case ts.SyntaxKind.PropertyAccessExpression: {
            return evaluatePropertyAccessExpression(expression as ts.PropertyAccessExpression, sourceFile);
        }
        case ts.SyntaxKind.ElementAccessExpression: {
            return evaluateElementAccessExpression(expression as ts.ElementAccessExpression, sourceFile);
        }
        default: {
            throw new Error(`Evaluation of expression '${expression.getText()}' (${getSyntaxKind(expression.kind)}) is not supported.`);
        }
    }
}

function resolveModuleSource(moduleName: string, sourceFile: ts.SourceFile): ts.SourceFile {
    const resolvedModule = ts.resolveModuleName(moduleName, sourceFile.fileName, compilerOptions, {
        fileExists,
        readFile
    });

    if (!resolvedModule || !resolvedModule.resolvedModule) {
        throw new Error(`Sorry cannot resolve '${moduleName}'`);
    }

    return getSourceFile(resolvedModule.resolvedModule.resolvedFileName);
}
function evaluatePropertyAccessExpression(expression: ts.PropertyAccessExpression, sourceFile: ts.SourceFile): string {
    if (ts.isIdentifier(expression.getChildAt(0))) {
        const identifier = expression.getChildAt(0).getText();
        const identifiers = gatherIdentifiers(sourceFile);
        if (identifiers.has(identifier)) {
            // Do something.
            const expr = (identifiers.get(identifier)! as ts.StringLiteral);
            const src = resolveModuleSource(expr.text, sourceFile);
            console.log(expr.getText());
            const identifiersInModule = gatherIdentifiers(src);
            console.log(identifiersInModule.size);
        }

    }
    // expression.forEachChild(childExpression => {

    // });
    return '';
}
function evaluateElementAccessExpression(_expression: ts.ElementAccessExpression, _sourceFile: ts.SourceFile): string {
    return '';
}
function printChildExpression(node: ts.Node, indentSize: number = 0) {
    // if (node.getChildCount() === 0) {
    //     return;
    // }
    const indent = ' '.repeat(indentSize);
    const kind = getSyntaxKind(node.kind);
    const text = node.getText();
    console.log(`${indent}${kind.name} - ${text}`);
    node.forEachChild(n => {
        printChildExpression(n, indentSize + 2);
    });
}

function procesTelemetry(sourceFile: ts.SourceFile) {
    // sourceFile.statements.filter(s => {
    //     console.log(s.pos);
    // });
    gatherIdentifiers(sourceFile);
    printChildExpression(sourceFile.statements[0]);
    printChildExpression(sourceFile.statements[1]);
    printChildExpression(sourceFile.statements[2]);
    const declaration = getTelemetryDeclaration(sourceFile);
    declaration.forEachChild(child => {
        if (!ts.isPropertySignature(child)) {
            return;
        }
        const property = child as ts.PropertySignature;
        if (property.name.getText(sourceFile) !== '[EventName.TERMINAL_SHELL_IDENTIFICATION]') {
            return;
        }
        if (property.name.kind !== ts.SyntaxKind.ComputedPropertyName) {
            throw new Error(`Telemetry event names must not be hardcoded, please define a constant. Property '${property.name.getText(sourceFile)}'`);
        }
        printSytaxKind(property.name.kind);
        const computedName = property.name as ts.ComputedPropertyName;
        console.log(`Expression = '${computedName.expression}'`);
        console.log(property.name.getText(sourceFile));
        printChildExpression(computedName.expression);
        evaluateExpression(computedName.expression, sourceFile);
        computedName.expression.forEachChild(c => {
            if (!ts.isIdentifier(c)) {
                return;
            }
            console.log(c.pos);
            printSytaxKind(c.kind);
            const identifier = c as ts.Identifier;
            if (identifier.text !== 'EventName') {
                return;
            }
            console.log(identifier.text);
            console.log(c.getText(sourceFile));
            console.log(identifier.getChildCount());
            // printSytaxKind(c.kind);
        });
        // printSytaxKind(property.kind);
    });
}

export function delint(sourceFile: ts.SourceFile) {
    delintNode(sourceFile);
    // sourceFile.statements.forEach(item => {
    //     if (item.kind === ts.SyntaxKind.InterfaceDeclaration) {
    //         // const interfaceNode: ts.isInterfaceDeclaration()
    //         // if (ts.isInterfaceDeclaration(item)) {
    //         //     console.log('123123213123123');
    //         //     return;
    //         // }
    //         const interfaceNode = item as ts.InterfaceDeclaration;
    //         console.log(interfaceNode.name.text);
    //         // console.log(item.getFullText(sourceFile));
    //         // console.log('1');
    //         printSytaxKind(item.getFirstToken(sourceFile)!.kind);
    //         // console.log('2');
    //         // console.log(item.getText(sourceFile));
    //         // console.log('3');
    //         // printSytaxKind(item.kind);
    //     }
    // });
    const item = getTelemetryDeclaration(sourceFile);
    printSytaxKind(item.kind);
    function delintNode(node: ts.Node) {
        // printSytaxKind(node.kind);
        // tslint:disable-next-line:switch-default
        switch (node.kind) {
            case ts.SyntaxKind.ForStatement:
            case ts.SyntaxKind.ForInStatement:
            case ts.SyntaxKind.WhileStatement:
            case ts.SyntaxKind.DoStatement:
                if ((node as ts.IterationStatement).statement.kind !== ts.SyntaxKind.Block) {
                    report(
                        node,
                        'A looping statement\'s contents should be wrapped in a block body.'
                    );
                }
                break;

            case ts.SyntaxKind.IfStatement:
                const ifStatement = node as ts.IfStatement;
                if (ifStatement.thenStatement.kind !== ts.SyntaxKind.Block) {
                    report(
                        ifStatement.thenStatement,
                        'An if statement\'s contents should be wrapped in a block body.'
                    );
                }
                if (
                    ifStatement.elseStatement &&
                    ifStatement.elseStatement.kind !== ts.SyntaxKind.Block &&
                    ifStatement.elseStatement.kind !== ts.SyntaxKind.IfStatement
                ) {
                    report(
                        ifStatement.elseStatement,
                        'An else statement\'s contents should be wrapped in a block body.'
                    );
                }
                break;

            case ts.SyntaxKind.BinaryExpression:
                const op = (node as ts.BinaryExpression).operatorToken.kind;
                if (
                    op === ts.SyntaxKind.EqualsEqualsToken ||
                    op === ts.SyntaxKind.ExclamationEqualsToken
                ) {
                    report(node, 'Use \'===\' and \'!==\'.');
                }
                break;
        }

        ts.forEachChild(node, delintNode);
    }

    function report(node: ts.Node, message: string) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart()
        );
        console.log(
            `${sourceFile.fileName} (${line + 1},${character + 1}): ${message}`
        );
    }
}

function getSourceFile(fileName: string) {
    return ts.createSourceFile(
        fileName,
        readFileSync(fileName).toString(),
        ts.ScriptTarget.ES2018,
    /*setParentNodes */ true
    );
}
function processFile(fileName: string) {
    // Parse a file
    const sourceFile = getSourceFile(fileName);

    // delint it
    procesTelemetry(sourceFile);
}

processFile(filePath);
