// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { ConfigurationTarget } from 'vscode';
import { ConfigurationService } from '../../../../client/common/configuration/service';
import { IConfigurationService } from '../../../../client/common/types';
import { Architecture } from '../../../../client/common/utils/platform';
import {
    JupyterInterpreterConfigfurationResponse,
    JupyterInterpreterConfigurationService
} from '../../../../client/datascience/jupyter/interpreter/jupyterInterpreterConfiguration';
import { JupyterInterpreterSelector } from '../../../../client/datascience/jupyter/interpreter/jupyterInterpreterSelector';
import { JupyterInterpreterService } from '../../../../client/datascience/jupyter/interpreter/jupyterInterpreterService';
import { IInterpreterService, InterpreterType, PythonInterpreter } from '../../../../client/interpreter/contracts';
import { InterpreterService } from '../../../../client/interpreter/interpreterService';

suite('Data Science - Jupyter Interpreter Service', () => {
    let jupyterInterpreterService: JupyterInterpreterService;
    let interpreterSelector: JupyterInterpreterSelector;
    let interpreterConfiguration: JupyterInterpreterConfigurationService;
    let configService: IConfigurationService;
    let interpreterService: IInterpreterService;
    let selectedInterpreterEventArgs: PythonInterpreter | undefined;
    const pythonInterpreter: PythonInterpreter = {
        path: 'some path',
        architecture: Architecture.Unknown,
        sysPrefix: '',
        sysVersion: '',
        type: InterpreterType.Unknown
    };
    const secondPythonInterpreter: PythonInterpreter = {
        path: 'second interpreter path',
        architecture: Architecture.Unknown,
        sysPrefix: '',
        sysVersion: '',
        type: InterpreterType.Unknown
    };

    setup(() => {
        interpreterSelector = mock(JupyterInterpreterSelector);
        interpreterConfiguration = mock(JupyterInterpreterConfigurationService);
        configService = mock(ConfigurationService);
        interpreterService = mock(InterpreterService);
        jupyterInterpreterService = new JupyterInterpreterService(
            instance(interpreterSelector),
            instance(interpreterConfiguration),
            instance(interpreterService),
            instance(configService)
        );
        jupyterInterpreterService.onDidChangeInterpreter(e => (selectedInterpreterEventArgs = e));
        when(interpreterSelector.selectInterpreter()).thenResolve(pythonInterpreter);
    });

    test('Cancelling interpreter configuration is same as cancelling selection of an interpreter', async () => {
        when(interpreterConfiguration.configureInterpreter(pythonInterpreter)).thenResolve(JupyterInterpreterConfigfurationResponse.cancel);

        const response = await jupyterInterpreterService.selectInterpreter();

        verify(interpreterConfiguration.configureInterpreter(pythonInterpreter)).once();
        assert.equal(response, undefined);
        assert.isUndefined(selectedInterpreterEventArgs);
    });
    test('Once selected interpreter must be stored in settings and event fired', async () => {
        when(interpreterConfiguration.configureInterpreter(pythonInterpreter)).thenResolve(JupyterInterpreterConfigfurationResponse.ok);
        when(configService.updateSetting(anything(), anything(), anything(), anything())).thenResolve();

        const response = await jupyterInterpreterService.selectInterpreter();

        verify(interpreterConfiguration.configureInterpreter(pythonInterpreter)).once();
        verify(configService.updateSetting(anything(), anything(), anything(), anything())).once();
        verify(configService.updateSetting('dataScience.jupyterInterpreter', pythonInterpreter.path, undefined, ConfigurationTarget.Global)).once();
        assert.equal(response, pythonInterpreter);
        assert.equal(selectedInterpreterEventArgs, pythonInterpreter);
    });
    test('Select another interpreter if user opts to not install dependencies', async () => {
        when(interpreterConfiguration.configureInterpreter(pythonInterpreter)).thenResolve(JupyterInterpreterConfigfurationResponse.selectAnotherInterpreter);
        when(interpreterConfiguration.configureInterpreter(secondPythonInterpreter)).thenResolve(JupyterInterpreterConfigfurationResponse.ok);
        let interpreterSelection = 0;
        when(interpreterSelector.selectInterpreter()).thenCall(() => {
            // When selecting intererpter for first time, return first interpreter
            // When selected interpretre
            interpreterSelection += 1;
            return interpreterSelection === 1 ? pythonInterpreter : secondPythonInterpreter;
        });

        const response = await jupyterInterpreterService.selectInterpreter();

        verify(interpreterSelector.selectInterpreter()).twice();
        verify(interpreterConfiguration.configureInterpreter(pythonInterpreter)).once();
        verify(interpreterConfiguration.configureInterpreter(secondPythonInterpreter)).once();
        verify(configService.updateSetting(anything(), anything(), anything(), anything())).once();
        verify(configService.updateSetting('dataScience.jupyterInterpreter', secondPythonInterpreter.path, undefined, ConfigurationTarget.Global)).once();
        assert.equal(response, secondPythonInterpreter);
        assert.equal(selectedInterpreterEventArgs, secondPythonInterpreter);
    });
});
