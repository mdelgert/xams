import React from "react";
import { useAdminDashContext } from "../AdminDashboard";
import { NavLink, Grid } from "@mantine/core";
import { IconClock } from "@tabler/icons-react";
import Field from "../../components/Field";
import JobForm from "../JobForm";
import DataTable from "../../components/DataTable";
import CopyId from "../components/CopyId";

const AdminDashJobs = () => {
  const ctx = useAdminDashContext();
  return (
    <>
      {ctx.tables.filter((table) => table.tableName === "Job").length > 0 &&
        !ctx.props.hiddenMenuItems?.includes("Jobs") && (
          <NavLink
            label="Jobs"
            icon={<IconClock size={16} strokeWidth={2} color={ctx.color} />}
            onClick={() =>
              ctx.setActiveComponent({
                component: (
                  <DataTable
                    tableName="Job"
                    orderBy={[
                      {
                        field: "Name",
                        order: "asc",
                      },
                    ]}
                    fields={[
                      "Name",
                      "Status",
                      "Queue",
                      "IsActive",
                      "LastExecution",
                    ]}
                    filters={[
                      {
                        field: "Tag",
                        operator: "!=",
                        value: "System",
                      },
                    ]}
                    canCreate={false}
                    canDelete={false}
                    formCloseOnEscape={true}
                    formAppendButton={(formbuilder) => {
                      return (
                        <>
                          {formbuilder.operation === "UPDATE" && (
                            <div className="w-full flex justify-start items-center gap-1">
                              <CopyId
                                value={
                                  formbuilder.data[`${formbuilder.tableName}Id`]
                                }
                              />
                            </div>
                          )}
                          <div className="mr-2">
                            <JobForm formBuilder={formbuilder}></JobForm>
                          </div>
                        </>
                      );
                    }}
                    appendCustomForm={(formbuilder) => {
                      if (formbuilder.operation === "CREATE") {
                        <></>;
                      }
                      return (
                        <div className="w-full h-96">
                          <DataTable
                            title="History"
                            tableName={"JobHistory"}
                            fields={[
                              "Status",
                              "Message",
                              "CreatedDate",
                              "CompletedDate",
                            ]}
                            filters={[
                              {
                                field: "JobId",
                                value: formbuilder.snapshot?.JobId,
                              },
                            ]}
                            orderBy={[
                              {
                                field: "CreatedDate",
                                order: "desc",
                              },
                            ]}
                            refreshInterval={1000}
                            maxResults={100}
                            canUpdate={false}
                            customForm={(formbuilder) => {
                              return (
                                <div className="w-full flex flex-col gap-2">
                                  <Grid>
                                    <Grid.Col span={4}>
                                      <Field name={"Name"}></Field>
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                      <Field name={"JobId"}></Field>
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                      <Field name={"Status"}></Field>
                                    </Grid.Col>
                                  </Grid>
                                  <Grid>
                                    <Grid.Col span={4}>
                                      <Field name={"CreatedDate"}></Field>
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                      <Field name={"CompletedDate"}></Field>
                                    </Grid.Col>
                                    <Grid.Col span={4}></Grid.Col>
                                  </Grid>
                                  <div className="w-full h-48">
                                    <Field
                                      name={"Message"}
                                      varient="textarea"
                                    ></Field>
                                  </div>
                                </div>
                              );
                            }}
                          ></DataTable>
                        </div>
                      );
                    }}
                  />
                ),
              })
            }
          ></NavLink>
        )}
    </>
  );
};

export default AdminDashJobs;
