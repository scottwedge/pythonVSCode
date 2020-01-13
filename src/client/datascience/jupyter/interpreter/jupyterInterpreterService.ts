// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { ConfigurationTarget, Event, EventEmitter } from 'vscode';
import { IConfigurationService } from '../../../common/types';
import { IInterpreterService, PythonInterpreter } from '../../../interpreter/contracts';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import { JupyterInterpreterConfigfurationResponse, JupyterInterpreterConfigurationService } from './jupyterInterpreterConfiguration';
import { JupyterInterpreterSelector } from './jupyterInterpreterSelector';

@injectable()
export class JupyterInterpreterService {
    private _onDidChangeInterpreter = new EventEmitter<PythonInterpreter>();
    public get onDidChangeInterpreter(): Event<PythonInterpreter> {
        return this._onDidChangeInterpreter.event;
    }

    constructor(
        @inject(JupyterInterpreterSelector) private readonly jupyterInterpreterSelector: JupyterInterpreterSelector,
        @inject(JupyterInterpreterConfigurationService) private readonly interpreterConfiguration: JupyterInterpreterConfigurationService,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IConfigurationService) private readonly configService: IConfigurationService
    ) {}
    /**
     * Gets the selected interpreter configured to run Jupyter.
     *
     * @returns {(Promise<PythonInterpreter | undefined>)}
     * @memberof JupyterInterpreterService
     */
    public async getSelectedInterpreter(): Promise<PythonInterpreter | undefined> {
        const pythonPath = this.configService.getSettings(undefined).datascience.jupyterInterpreter;
        if (!pythonPath) {
            return;
        }

        return this.interpreterService.getInterpreterDetails(pythonPath, undefined);
    }
    /**
     * Selects and interpreter to run jupyter server.
     * Validates and configures the interpreter.
     * Once completed, the interpreter is stored in settings, else user can select another interpreter.
     *
     * @returns {(Promise<PythonInterpreter | undefined>)}
     * @memberof JupyterInterpreterService
     */
    public async selectInterpreter(): Promise<PythonInterpreter | undefined> {
        const interpreter = await this.jupyterInterpreterSelector.selectInterpreter();
        if (!interpreter) {
            sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, { result: 'notSelected' });
            return;
        }

        const result = await this.interpreterConfiguration.configureInterpreter(interpreter);
        switch (result) {
            case JupyterInterpreterConfigfurationResponse.ok: {
                await this.configService.updateSetting('dataScience.jupyterInterpreter', interpreter.path, undefined, ConfigurationTarget.Global);
                this._onDidChangeInterpreter.fire(interpreter);
                sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, { result: 'selected' });
                return interpreter;
            }
            case JupyterInterpreterConfigfurationResponse.cancel:
                sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, { result: 'installationCancelled' });
                return;
            default:
                return this.selectInterpreter();
        }
    }
}
