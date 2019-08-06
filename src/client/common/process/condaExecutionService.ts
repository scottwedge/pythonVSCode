// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { PythonInterpreter } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { PythonExecutionService } from './pythonProcess';
import { IProcessService } from './types';

@injectable()
export class CondaExecutionService extends PythonExecutionService {
    constructor(
        serviceContainer: IServiceContainer,
        procService: IProcessService,
        pythonPath: string,
        private readonly condaFile: string,
        private readonly interpreter: PythonInterpreter
    ) {
        super(serviceContainer, procService, pythonPath);
    }
    protected getExecutableInfo(command: string, args: string[]): { command: string; args: string[] } {
        if (this.interpreter.envName) {
            return {
                command: this.condaFile,
                args: ['run', '-n', this.interpreter.envName, 'python', ...args]
            };
        }
        if (this.interpreter.envPath) {
            return {
                command: this.condaFile,
                args: ['run', '-p', this.interpreter.envPath, 'python', ...args]
            };
        }
        return { command, args };
    }
}
