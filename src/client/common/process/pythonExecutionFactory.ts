// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';

import { IEnvironmentActivationService } from '../../interpreter/activation/types';
import { ICondaService, IInterpreterService, InterpreterType } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { IConfigurationService, IDisposableRegistry } from '../types';
import { CondaExecutionService } from './condaExecutionService';
import { ProcessService } from './proc';
import { PythonExecutionService } from './pythonProcess';
import {
    ExecutionFactoryCreateWithEnvironmentOptions,
    ExecutionFactoryCreationOptions,
    IBufferDecoder,
    IProcessLogger,
    IProcessService,
    IProcessServiceFactory,
    IPythonExecutionFactory,
    IPythonExecutionService
} from './types';

@injectable()
export class PythonExecutionFactory implements IPythonExecutionFactory {
    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IEnvironmentActivationService) private readonly activationHelper: IEnvironmentActivationService,
        @inject(IProcessServiceFactory) private readonly processServiceFactory: IProcessServiceFactory,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(ICondaService) private readonly condaService: ICondaService,
        @inject(IBufferDecoder) private readonly decoder: IBufferDecoder
    ) {}
    public async create(options: ExecutionFactoryCreationOptions): Promise<IPythonExecutionService> {
        const pythonPath = options.pythonPath ? options.pythonPath : this.configService.getSettings(options.resource).pythonPath;
        const [processService, interpreter] = await Promise.all([
            this.processServiceFactory.create(options.resource),
            options.pythonPath ? this.interpreterService.getInterpreterDetails(options.pythonPath) : this.interpreterService.getActiveInterpreter(options.resource)
        ]);
        const processLogger = this.serviceContainer.get<IProcessLogger>(IProcessLogger);
        processService.on('exec', processLogger.logProcess.bind(processLogger));
        if (interpreter && interpreter.type === InterpreterType.Conda) {
            return new CondaExecutionService(this.serviceContainer, processService, pythonPath, this.condaService, interpreter);
        } else {
            return new PythonExecutionService(this.serviceContainer, processService, pythonPath);
        }
    }
    public async createActivatedEnvironment(options: ExecutionFactoryCreateWithEnvironmentOptions): Promise<IPythonExecutionService> {
        const envVars = await this.activationHelper.getActivatedEnvironmentVariables(options.resource, options.interpreter, options.allowEnvironmentFetchExceptions);
        const hasEnvVars = envVars && Object.keys(envVars).length > 0;
        sendTelemetryEvent(EventName.PYTHON_INTERPRETER_ACTIVATION_ENVIRONMENT_VARIABLES, undefined, { hasEnvVars });
        if (!hasEnvVars) {
            return this.create({ resource: options.resource, pythonPath: options.interpreter ? options.interpreter.path : undefined });
        }
        const pythonPath = options.interpreter ? options.interpreter.path : this.configService.getSettings(options.resource).pythonPath;
        const processService: IProcessService = new ProcessService(this.decoder, { ...envVars });
        const processLogger = this.serviceContainer.get<IProcessLogger>(IProcessLogger);
        processService.on('exec', processLogger.logProcess.bind(processLogger));
        this.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry).push(processService);
        return new PythonExecutionService(this.serviceContainer, processService, pythonPath);
    }
    public async createCondaExecutionService(): Promise<IPythonExecutionService>{

    }
}
