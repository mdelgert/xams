import { MetadataResponse } from "../api/MetadataResponse";
import useAuthRequest from "../hooks/useAuthRequest";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import useLookupStore from "../stores/useLookupStore";
import { usePermissionStore } from "../stores/usePermissionStore";
import {
  FieldValue,
  LookupExclusions,
  LookupQuery,
  ValidationMessage,
  formbuilderReducer,
  getFormBuilderInitState,
} from "../reducers/formbuilderReducer";
import { DataTableRef } from "../components/datatable/DataTableTypes";
import { API_DATA_CREATE, API_DATA_UPDATE } from "../apiurls";
import useGuid from "./useGuid";

export type SaveEventResponse = {
  continue: boolean;
  parameters?: any;
};

type FBEvent = {
  eventName: string;
  callback: Function | ((...arg: any[]) => Promise<boolean>);
};

interface useFormBuilderProps {
  tableName: string;
  id?: string | null;
  metadata?: MetadataResponse;
  defaults?: FieldValue[];
  snapshot?: any; // This is only set when a record is being updated and is the original data (state.data is the current data being edited)
  lookupExclusions?: LookupExclusions[];
  lookupQueries?: LookupQuery[];
  canUpdate?: boolean;
  canCreate?: boolean;
  onPreSave?: (submissionData: any) => Promise<SaveEventResponse>; // If returns false, save will be cancelled
  onPostSave?: (
    operation: "CREATE" | "UPDATE" | "FAILED",
    id: string,
    data: any
  ) => Promise<void>;
  forceShowLoading?: boolean; // If true, loading will be displayed until setShowLoading(false) is called
}

type OnLoadOptions = {
  id?: string | null;
  refresh: boolean;
  refreshDatatables: boolean;
  forceShowLoading?: boolean;
};

export type PreSaveEvent = (submissionData: any) => Promise<SaveEventResponse>;

export type PostSaveEvent = (
  operation: "CREATE" | "UPDATE" | "FAILED",
  id: string,
  data: any
) => void;

const useFormBuilder = <T,>(props: useFormBuilderProps) => {
  const authRequest = useAuthRequest();
  const permissionStore = usePermissionStore();
  const guid = useGuid();
  const lookupStore = useLookupStore();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [state, dispatch] = useReducer(
    formbuilderReducer,
    getFormBuilderInitState<T>()
  );
  const [snapshotQueue, setSnapshotQueue] = useState<any[]>([]);
  let childDataTables: DataTableRef[] = [];
  let eventListeners: FBEvent[] = [];
  let requiredFields: string[] = [];

  const onLoad = async (options: OnLoadOptions) => {
    if (props.tableName == null || props.tableName === "") {
      return;
    }

    if (!options.refresh) {
      dispatch({
        type: "START_INITIAL_LOAD",
        payload: {
          tableName: props.tableName,
          data:
            state.metadata != null
              ? await getInitialData(state.metadata, undefined)
              : undefined,
          forceIsLoading:
            options.forceShowLoading ?? props.forceShowLoading ?? false,
        },
      });
    }

    let metadata = props.metadata;
    if (metadata == null) {
      metadata = await authRequest.metadata(props.tableName);
    }

    let snapshot = props.snapshot;
    let missingRecord = false;
    let canUpdate = false;
    let canCreate = false;
    if ((props.snapshot == null && options.id != null) || options.refresh) {
      const dataResp = await authRequest.read<T>({
        tableName: props.tableName,
        fields: ["*"],
        maxResults: 1,
        page: 1,
        id: options.refresh
          ? (state.snapshot as any)[`${props.tableName}Id`]
          : options.id,
      });
      if (dataResp == null || !dataResp.succeeded) {
        return;
      }
      if (dataResp.data.results == null || dataResp.data.results.length === 0) {
        missingRecord = true;
      } else {
        snapshot = dataResp.data.results[0];
        canUpdate = snapshot["_ui_info_"].canUpdate;
      }
    }

    if (props.snapshot != null) {
      canUpdate = props.snapshot["_ui_info_"].canUpdate;
    }

    let initialData = await getInitialData(metadata, snapshot);

    let tablePermissions = await permissionStore.getTablePermissions(
      authRequest,
      props.tableName
    );
    if (tablePermissions.create !== "NONE") {
      canCreate = true;
    }

    // If we are forcefully disabling the ability to create\update
    if (props.canUpdate != null && props.canUpdate === false) {
      canUpdate = false;
    }

    if (props.canCreate != null && props.canCreate === false) {
      canCreate = false;
    }

    if (options.refreshDatatables) {
      await reloadDataTables();
    }

    dispatch({
      type: "INITIAL_LOAD_COMPLETE",
      payload: {
        metadata: metadata,
        snapshot: snapshot,
        data: initialData,
        canUpdate: canUpdate,
        canCreate: canCreate,
        canRead: {
          canRead: missingRecord ? false : true,
          message: missingRecord
            ? `This record doesn't exist or you are missing the required permissions to access ${props.tableName}`
            : "",
        },
      },
    });

    if (snapshotQueue.length > 0) {
      setSnapshot(snapshotQueue.pop());
      setSnapshotQueue([]);
    }
  };

  const getInitialData = async (metadata: MetadataResponse, snapshot: any) => {
    if (metadata !== undefined) {
      // If this is a Create
      if (snapshot === undefined) {
        return {
          ...(await getClearedValues(metadata)),
          ...props.defaults?.reduce(
            (a, b) => ({ ...a, [b.field]: b.value }),
            {}
          ),
        };
      }
      // If this is a Update
      if (snapshot != null) {
        // remove null fields from snapshot
        const dataToUpdate = Object.keys(snapshot).reduce((object, key) => {
          if (
            snapshot[key] !== null &&
            (metadata.fields.find((x) => x.name === key) !== undefined ||
              ["_ui_info_"].includes(key) ||
              key === `${props.tableName}Id`)
          ) {
            object[key] = snapshot[key];
          }
          return object;
        }, {} as any);
        const editObject = {
          ...(await getClearedValues(metadata)),
          ...dataToUpdate,
        };
        return editObject;
      }
    }
  };

  const getClearedValues = async (metadata: MetadataResponse) => {
    // Set default values for fields of type Single, Int32, Int64, Double, Decimal to 0
    const numericDefaults = metadata.fields
      .filter(
        (field) =>
          field.type === "Single" ||
          field.type === "Int32" ||
          field.type === "Int64" ||
          field.type === "Double" ||
          field.type === "Decimal"
      )
      .map((field) => ({
        field: field.name,
        value: field.isNullable ? "" : 0,
      }));
    const stringDefaults = metadata?.fields
      .filter((field) => field.type === "String" || field.type === "Guid")
      .map((field) => ({
        field: field.name,
        value: "",
      }));
    const booleanDefaults = metadata?.fields
      .filter((field) => field.type === "Boolean")
      .map((field) => ({
        field: field.name,
        value: false,
      }));
    const defaultDate = new Date();
    defaultDate.setUTCHours(0, 0, 0, 0); // Default to today without time
    const dateDefaults = metadata?.fields
      .filter((field) => field.type === "DateTime")
      .map((field) => ({
        field: field.name,
        value: field.isNullable ? null : defaultDate.toISOString(),
      }));
    const nullableLookupDefaults = metadata?.fields
      .filter((field) => field.type === "Lookup")
      .map((field) => ({
        field: field.name,
        value:
          props.defaults?.find((x) => x.field === field.name)?.value ?? null,
      }));

    // Get the labels for any default lookups
    for (const field of metadata.fields ?? []) {
      if (field.type === "Lookup") {
        if (props.defaults !== undefined) {
          for (const lookupDefault of props.defaults ?? []) {
            if (lookupDefault.field === field.name) {
              await lookupStore.getLookupLabel(
                authRequest,
                field.name,
                field.lookupTable,
                field.lookupTableNameField,
                lookupDefault.value as string
              );
            }
          }
        }
      }
    }

    return {
      ...numericDefaults?.reduce((a, b) => ({ ...a, [b.field]: b.value }), {}),
      ...stringDefaults?.reduce((a, b) => ({ ...a, [b.field]: b.value }), {}),
      ...booleanDefaults?.reduce((a, b) => ({ ...a, [b.field]: b.value }), {}),
      ...dateDefaults?.reduce((a, b) => ({ ...a, [b.field]: b.value }), {}),
      ...nullableLookupDefaults?.reduce(
        (a, b) => ({ ...a, [b.field]: b.value }),
        {}
      ),
      _ui_info_: {
        canUpdate: true,
        canDelete: true,
      },
    };
  };

  const setSnapshot = async (snapshot: T, forceShowLoading?: boolean) => {
    if (state.metadata !== undefined) {
      const data = await getInitialData(state.metadata, snapshot);
      dispatch({
        type: "SET_DATA_TO_EDIT",
        payload: {
          data: data,
          snapshot: snapshot,
          ...(props.canUpdate != null ? { canUpdate: props.canUpdate } : {}),
          forceIsLoading: forceShowLoading ?? false,
        },
      });
    } else {
      // If the metadata hasn't been loaded yet, add the snapshot to the queue
      setSnapshotQueue((prev) => [...prev, snapshot]);
    }
  };

  const setField = (
    field: string,
    value: string | boolean | null | undefined | number
  ) => {
    dispatch({
      type: "SET_FIELD_VALUE",
      payload: {
        field: field,
        value: value,
      },
    });
  };

  const isDirty = (field?: string) => {
    if (field == null) {
      return state.dirtyFields.length > 0;
    }
    return state.dirtyFields.includes(field);
  };

  const addDataTable = (dataTable: DataTableRef) => {
    // If it already exists, replace it to avoid stale closures
    const existingDataTable = childDataTables.find(
      (x) => x.dataTableId === dataTable.dataTableId
    );

    if (existingDataTable != null) {
      childDataTables = childDataTables.filter(
        (x) => x.dataTableId !== dataTable.dataTableId
      );
    }

    childDataTables.push(dataTable);
  };

  const addRequiredField = (fieldName: string) => {
    // Add if it doesn't already exist
    if (!requiredFields.includes(fieldName)) {
      requiredFields.push(fieldName);
    }
  };

  const removeRequiredField = (fieldName: string) => {
    requiredFields = requiredFields.filter((x) => x !== fieldName);
  };

  const reloadDataTables = () => {
    for (const dataTable of childDataTables) {
      dataTable.refresh();
    }
  };

  const onSave = async (
    preValidate?: PreSaveEvent,
    preSaveEvent?: PreSaveEvent,
    postSaveEvent?: PostSaveEvent
  ) => {
    const submissionData = {
      ...(state.data as any),
    };

    let parameters = {} as any;

    if (preValidate != null) {
      const preResult = await preValidate(submissionData);
      if (!preResult.continue) {
        return;
      }
      // Append to parameters
      parameters = {
        ...parameters,
        ...preResult.parameters,
      };
    }
    if (!onValidate()) {
      return;
    }
    dispatch({
      type: "SET_IS_LOADING",
    });

    // Call the onPreSave event
    if (props.onPreSave != null) {
      const preSaveResult = await props.onPreSave(submissionData);
      if (preSaveResult.continue === false) {
        dispatch({
          type: "SUBMIT_CANCELLED",
        });
        return;
      }
      // Append to parameters
      parameters = {
        ...parameters,
        ...preSaveResult.parameters,
      };
    }
    // for (let saveEvent of state.eventListeners) {
    //   if (saveEvent.event === "PRE_SAVE") {
    //     const result = await saveEvent.callback(submissionData, parameters);
    //     if (result === false) {
    //       dispatch({
    //         type: "SUBMIT_CANCELLED",
    //       });
    //       return;
    //     }
    //   }
    // }
    for (let event of eventListeners) {
      if (event.eventName === "PRE_SAVE") {
        const result = await event.callback(submissionData, parameters);
        if (result === false) {
          dispatch({
            type: "SUBMIT_CANCELLED",
          });
          return;
        }
      }
    }

    if (preSaveEvent != null) {
      const preSaveResult = await preSaveEvent(submissionData);
      if (preSaveResult.continue === false) {
        dispatch({
          type: "SUBMIT_CANCELLED",
        });
        return;
      }
      // Append to parameters
      parameters = {
        ...parameters,
        ...preSaveResult.parameters,
      };
    }
    // End of onPreSave event

    // Save the data
    const resp = await authRequest.execute<any>({
      url: state.snapshot === undefined ? API_DATA_CREATE : API_DATA_UPDATE,
      method: state.snapshot === undefined ? "POST" : "PATCH",
      body: {
        tableName: state.metadata?.tableName,
        fields: submissionData,
        parameters: parameters,
      },
    });

    // Handle Post Save events
    if (resp?.succeeded === true) {
      if (props.onPostSave !== undefined) {
        await props.onPostSave(
          state.snapshot === undefined ? "CREATE" : "UPDATE",
          resp.data[`${props.tableName}Id`],
          resp.data
        );
      }
      for (let event of eventListeners) {
        if (event.eventName === "POST_SAVE") {
          event.callback(
            state.snapshot === undefined ? "CREATE" : "UPDATE",
            resp.data[`${props.tableName}Id`],
            resp.data
          );
        }
      }
      if (postSaveEvent != null) {
        postSaveEvent(
          state.snapshot === undefined ? "CREATE" : "UPDATE",
          resp.data[`${props.tableName}Id`],
          resp.data
        );
      }
    } else {
      if (props.onPostSave !== undefined) {
        await props.onPostSave("FAILED", "", {});
      }
      for (let event of eventListeners) {
        if (event.eventName === "POST_SAVE") {
          event.callback("FAILED", "", {});
        }
      }
      if (postSaveEvent != null) {
        postSaveEvent("FAILED", "", {});
      }
    }
    dispatch({
      type: "SUBMIT_COMPLETE",
    });
    reloadDataTables();
  };

  const onSaveSilent = async (parameters?: any) => {
    const resp = await authRequest.execute<any>({
      url: state.snapshot === undefined ? API_DATA_CREATE : API_DATA_UPDATE,
      method: state.snapshot === undefined ? "POST" : "PATCH",
      body: {
        tableName: state.metadata?.tableName,
        fields: state.data,
        parameters: parameters,
      },
    });
    return resp.data;
  };

  const on = (
    eventName: string,
    callback: Function | ((...arg: any[]) => Promise<boolean>)
  ) => {
    eventListeners.push({ eventName: eventName, callback: callback });
  };

  const onValidate = () => {
    const messages = [] as ValidationMessage[];
    for (const field of state.metadata?.fields ?? []) {
      const fieldValue = (state.data as any)[field.name];
      if (["CreatedById", "UpdatedById"].includes(field.name)) {
        continue;
      }
      if (
        ["Single", "Int32", "Int64", "Double", "Decimal"].includes(field.type)
      ) {
        if (fieldValue === "-" || fieldValue === ".") {
          const message = `\"${fieldValue}\" is not a valid number`;
          messages.push({
            field: field.name,
            message: message,
          });
        }
      }
      if (field.type === "Lookup" || field.type === "DateTime") {
        if (
          (field.isNullable === false ||
            field.isRequired ||
            requiredFields.includes(field.name)) &&
          (fieldValue === undefined || fieldValue === null)
        ) {
          const message = `${field.displayName} is required`;
          messages.push({
            field: field.name,
            message: message,
          });
          console.warn(message);
        }
      }
      if (field.isRequired === true || requiredFields.includes(field.name)) {
        if (
          fieldValue === undefined ||
          fieldValue === null ||
          fieldValue === ""
        ) {
          const message = `${field.displayName} is required`;
          messages.push({
            field: field.name,
            message: message,
          });
          console.warn(message);
        }
      }
      if (field.type === "Guid" && fieldValue !== "") {
        const validGuid = guid.validate(fieldValue);
        if (!validGuid) {
          const message = `${field.displayName} is not a valid Id`;
          messages.push({
            field: field.name,
            message: message,
          });
          console.warn(message);
        }
      }
    }
    if (messages.length > 0) {
      dispatch({
        type: "SET_VALIDATION_MESSAGES",
        payload: messages,
      });
      return false;
    }

    return true;
  };

  const setFieldError = (field: string, message: string) => {
    dispatch({
      type: "SET_VALIDATION_MESSAGE",
      payload: {
        field: field,
        message: message,
      },
    });
  };

  const loadRecord = async (id: string, setForceShowLoading?: boolean) => {
    await onLoad({
      id: id,
      refresh: false,
      refreshDatatables: true,
      forceShowLoading: setForceShowLoading,
    });
  };

  const clearEdits = () => {
    dispatch({
      type: "CLEAR_EDIT_DATA",
    });
  };

  const clear = () => {
    dispatch({
      type: "CLEAR",
    });
  };

  const setShowForceLoading = (loading: boolean) => {
    dispatch({
      type: "SET_FORCE_LOADING",
      payload: {
        forceIsLoading: loading,
      },
    });
  };

  useEffect(() => {
    if (props.tableName != null && props.tableName !== "") {
      onLoad({ id: props.id, refresh: false, refreshDatatables: false });
    }
  }, [props.tableName, props.id]);

  useEffect(() => {
    if (state.snapshot != props.snapshot) {
      setSnapshot(props.snapshot);
    }
  }, [props.snapshot]);

  // In the case when the snapshot is set before the metadata is loaded
  useEffect(() => {
    if (snapshotQueue.length > 0 && state.type === "INITIAL_LOAD_COMPLETE") {
      setSnapshot(snapshotQueue.pop());
      setSnapshotQueue([]);
    }
  }, [state.type, snapshotQueue]);

  // useEffect(() => {
  //   if (firstInputRef !== null && firstInputRef.current !== null) {
  //     setTimeout(() => {
  //       firstInputRef.current?.focus();
  //     }, 100);
  //   }
  // }, [firstInputRef, firstInputRef.current]);

  return {
    metadata: state.metadata,
    dispatch: dispatch,
    data: state.data as T,
    snapshot: state.snapshot as T,
    setSnapshot: setSnapshot,
    firstInputRef: firstInputRef,
    lookupExclusions: props.lookupExclusions ?? [],
    lookupQueries: props.lookupQueries ?? [],
    canUpdate: state.canUpdate,
    canCreate: state.canCreate,
    canRead: state.canRead,
    defaults: props.defaults,
    validationMessages: state.validationMessages,
    isLoading: state.isLoading || state.forceIsLoading,
    isSubmitted: state.isSubmitted,
    operation: (props.snapshot != null || state.snapshot != null
      ? "UPDATE"
      : "CREATE") as "UPDATE" | "CREATE",
    stateType: state.type,
    tableName: props.tableName,
    reload: (reloadDataTables: boolean = true) =>
      onLoad({
        id: (state as any).snapshot[`${props.tableName}Id`],
        refresh: true,
        refreshDatatables: reloadDataTables,
      }),
    setField: setField,
    setFieldError: setFieldError,
    isDirty: isDirty,
    addDataTable: addDataTable,
    addRequiredField: addRequiredField,
    removeRequiredField: removeRequiredField,
    reloadDataTables: reloadDataTables,
    save: onSave,
    saveSilent: onSaveSilent,
    load: loadRecord,
    on: on,
    clearEdits: clearEdits,
    clear: clear,
    validate: onValidate,
    setShowForceLoading: setShowForceLoading,
  };
};

export type useFormBuilderType<T = any> = ReturnType<typeof useFormBuilder<T>>;
export default useFormBuilder;
