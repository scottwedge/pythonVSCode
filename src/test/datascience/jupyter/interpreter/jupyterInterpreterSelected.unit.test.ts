// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter, Memento } from 'vscode';
import { PythonSettings } from '../../../../client/common/configSettings';
import { ConfigurationService } from '../../../../client/common/configuration/service';
import { IDataScienceSettings } from '../../../../client/common/types';
import { Architecture } from '../../../../client/common/utils/platform';
import { JupyterInterpreterSelected } from '../../../../client/datascience/jupyter/interpreter/jupyterInterpreterSelected';
import { JupyterInterpreterService } from '../../../../client/datascience/jupyter/interpreter/jupyterInterpreterService';
import { InterpreterType, PythonInterpreter } from '../../../../client/interpreter/contracts';
import { MockMemento } from '../../../mocks/mementos';

suite('Data Science - Jupyter Interpreter Selected', () => {
    let selected: JupyterInterpreterSelected;
    let memento: Memento;
    let dsSettings: IDataScienceSettings;
    let interpreterService: JupyterInterpreterService;
    let interpreterSelectedEventEmitter: EventEmitter<PythonInterpreter>;
    const pythonInterpreter: PythonInterpreter = {
        path: '',
        architecture: Architecture.Unknown,
        sysPrefix: '',
        sysVersion: '',
        type: InterpreterType.Unknown
    };

    setup(() => {
        // tslint:disable-next-line: no-any
        dsSettings = {} as any;
        const settings = mock(PythonSettings);
        const configService = mock(ConfigurationService);
        memento = mock(MockMemento);
        interpreterService = mock(JupyterInterpreterService);
        when(settings.datascience).thenReturn(dsSettings);
        when(configService.getSettings(undefined)).thenReturn(instance(settings));
        when(memento.update(anything(), anything())).thenResolve();
        interpreterSelectedEventEmitter = new EventEmitter<PythonInterpreter>();
        when(interpreterService.onDidChangeInterpreter).thenReturn(interpreterSelectedEventEmitter.event);
        selected = new JupyterInterpreterSelected(instance(memento), instance(configService), instance(interpreterService));
    });

    test('Update memento if interpreter has been set manually', async () => {
        dsSettings.jupyterInterpreter = 'jupyter.exe';

        await selected.activate();

        assert.isOk(selected.interpreterSetAtleastOnce);
    });
    test('Interpeter should not be set for fresh installs', async () => {
        when(memento.get(anything(), false)).thenReturn(false);

        await selected.activate();

        assert.isFalse(selected.interpreterSetAtleastOnce);
    });
    test('If memento is set, return true', async () => {
        when(memento.get(anything(), false)).thenReturn(true);

        assert.isOk(selected.interpreterSetAtleastOnce);
    });
    test('Update state if an interpreter is selected', async () => {
        await selected.activate();

        interpreterSelectedEventEmitter.fire(pythonInterpreter);

        assert.isOk(selected.interpreterSetAtleastOnce);
    });
});
