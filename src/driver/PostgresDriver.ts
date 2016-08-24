import {Driver} from "./Driver";
import {SchemaBuilder} from "../schema-builder/SchemaBuilder";
import {ConnectionIsNotSetError} from "./error/ConnectionIsNotSetError";
import {BaseDriver} from "./BaseDriver";
import {DriverOptions} from "./DriverOptions";
import {PostgresSchemaBuilder} from "../schema-builder/PostgresSchemaBuilder";
import {ObjectLiteral} from "../common/ObjectLiteral";
import {DatabaseConnection} from "./DatabaseConnection";

/**
 * This driver organizes work with postgres database.
 */
export class PostgresDriver extends BaseDriver implements Driver {

    // -------------------------------------------------------------------------
    // Private Properties
    // -------------------------------------------------------------------------

    /**
     * Postgres library.
     */
    private postgres: any;

    /**
     * Connection to postgres database.
     */
    private databaseConnection: DatabaseConnection|undefined;

    /**
     * Postgres pool.
     */
    private pool: any;

    /**
     * Pool of database connections.
     */
    private databaseConnectionPool: DatabaseConnection[] = [];

    // -------------------------------------------------------------------------
    // Getter Methods
    // -------------------------------------------------------------------------

    /**
     * Access to the native implementation of the database.
     */
    get native() {
        return {
            driver: this.postgres,
            connection: this.databaseConnection ? this.databaseConnection.connection : undefined,
            pool: this.pool
        };
    }

    /**
     * Access to the native connection to the database.
     */
    get nativeConnection(): any {
        return this.databaseConnection;
    }

    /**
     * Database name to which this connection is made.
     */
    get db(): string {
        // if (this.postgresConnection && this.postgresConnection.config.database)
        //     return this.postgresConnection.config.database;

        if (this.connectionOptions.database)
            return this.connectionOptions.database;

        throw new Error("Cannot get the database name. Since database name is not explicitly given in configuration " +
            "(maybe connection url is used?), database name cannot be retrieved until connection is made.");
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(public connectionOptions: DriverOptions, postgres?: any) {
        super();

        // if driver dependency is not given explicitly, then try to load it via "require"
        if (!postgres && require) {
            try {
                postgres = require("pg");

            } catch (e) {
                throw new Error("Postgres package has not been found installed. Try to install it: npm install pg --save");
            }
        } else {
            throw new Error("Cannot load postgres driver dependencies. Try to install all required dependencies.");
        }

        this.postgres = postgres;
    }

    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------

    escapeColumnName(columnName: string): string {
        return "\"" + columnName + "\"";
    }

    escapeAliasName(aliasName: string): string {
        return "\"" + aliasName + "\"";
    }

    escapeTableName(tableName: string): string {
        return "\"" + tableName + "\"";
    }

    retrieveDatabaseConnection(): Promise<DatabaseConnection> {
        if (this.pool) {
            return new Promise((ok, fail) => {
                this.pool.connect((err: any, connection: any, release: Function) => {
                    if (err) {
                        fail(err);
                        return;
                    }

                    let dbConnection = this.databaseConnectionPool.find(dbConnection => dbConnection.connection === connection);
                    if (!dbConnection) {
                        dbConnection = {
                            id: this.databaseConnectionPool.length,
                            connection: connection,
                            isTransactionActive: false
                        };
                        this.databaseConnectionPool.push(dbConnection);
                    }
                    dbConnection.releaseCallback = release;
                    ok(dbConnection);
                });
            });
        }

        if (this.databaseConnection) // todo: rename postgresConnection and mysqlConnection to databaseConnection
            return Promise.resolve(this.databaseConnection);

        throw new ConnectionIsNotSetError("postgres");
    }

    releaseDatabaseConnection(dbConnection: DatabaseConnection): Promise<void> {
        if (this.pool && dbConnection.releaseCallback) {
            dbConnection.releaseCallback();
        }

        return Promise.resolve();
    }

    /**
     * Creates a schema builder which can be used to build database/table schemas.
     */
    createSchemaBuilder(dbConnection: DatabaseConnection): SchemaBuilder {
        return new PostgresSchemaBuilder(this, dbConnection);
    }

    /**
     * Performs connection to the database based on given connection options.
     */
    connect(): Promise<void> {
        const options = Object.assign({}, {
            host: this.connectionOptions.host,
            user: this.connectionOptions.username,
            password: this.connectionOptions.password,
            database: this.connectionOptions.database,
            port: this.connectionOptions.port
        }, this.connectionOptions.extra || {});

        if (this.connectionOptions.usePool === false) {
            return new Promise<void>((ok, fail) => {
                this.databaseConnection = {
                    id: 1,
                    connection: new this.postgres.Client(options),
                    isTransactionActive: false
                };
                this.databaseConnection.connection.connect((err: any) => err ? fail(err) : ok());
            });

        } else {
            this.pool = new this.postgres.Pool(options);
            return Promise.resolve();
        }
    }

    /**
     * Closes connection with database.
     */
    disconnect(): Promise<void> {
        this.checkIfConnectionSet();

        return new Promise<void>((ok, fail) => {
            if (this.databaseConnection) {
                this.databaseConnection.connection.end(/*(err: any) => err ? fail(err) : ok()*/); // todo: check if it can emit errors
                this.databaseConnection = undefined;
            }

            if (this.databaseConnectionPool) {
                this.databaseConnectionPool.forEach(dbConnection => {
                    if (dbConnection && dbConnection.releaseCallback) {
                        dbConnection.releaseCallback();
                    }
                });
                this.pool = undefined;
                this.databaseConnectionPool = [];
            }

            ok();
        });
    }

    /**
     * Escapes given value.
     */
    escape(dbConnection: DatabaseConnection, value: any): any {
        return value; // TODO: this.postgresConnection.escape(value);
    }

    /**
     * Executes a given SQL query.
     */
    query<T>(dbConnection: DatabaseConnection, query: string, parameters?: any[]): Promise<T> {
        this.checkIfConnectionSet();

        // console.log("query: ", query);
        // console.log("parameters: ", parameters);
        this.logQuery(query);
        return new Promise<T>((ok, fail) => {
            dbConnection.connection.query(query, parameters, (err: any, result: any) => {
                if (err) {
                    this.logFailedQuery(query);
                    this.logQueryError(err);
                    fail(err);
                } else {
                    ok(result.rows);
                }
            });
        });
    }

    /**
     * Starts transaction.
     */
    async beginTransaction(dbConnection: DatabaseConnection): Promise<void> {
        if (dbConnection.isTransactionActive)
            throw new Error(`Transaction already started for the given connection, commit current transaction before starting a new one.`);

        await this.query(dbConnection, "START TRANSACTION");
        dbConnection.isTransactionActive = true;
    }

    /**
     * Commits transaction.
     */
    async commitTransaction(dbConnection: DatabaseConnection): Promise<void> {
        if (!dbConnection.isTransactionActive)
            throw new Error(`Transaction is not started yet, start transaction before committing it.`);

        await this.query(dbConnection, "COMMIT");
        dbConnection.isTransactionActive = false;
    }

    /**
     * Rollbacks transaction.
     */
    async rollbackTransaction(dbConnection: DatabaseConnection): Promise<void> {
        if (!dbConnection.isTransactionActive)
            throw new Error(`Transaction is not started yet, start transaction before rolling it back.`);

        await this.query(dbConnection, "ROLLBACK");
        dbConnection.isTransactionActive = false;
    }

    /**
     * Clears all tables in the currently connected database.
     */
    clearDatabase(dbConnection: DatabaseConnection): Promise<void> {
        this.checkIfConnectionSet();

        const dropTablesQuery = `SELECT 'DROP TABLE IF EXISTS "' || tablename || '" CASCADE;' as q FROM pg_tables WHERE schemaname = 'public'`;
        return this.query<any[]>(dbConnection, dropTablesQuery)
            .then(results => Promise.all(results.map(q => this.query(dbConnection, q["q"]))))
            .then(() => {});
    }

    buildParameters(sql: string, parameters: ObjectLiteral) {
        if (!parameters || !Object.keys(parameters).length)
            return [];
        const builtParameters: any[] = [];
        const keys = Object.keys(parameters).map(parameter => "(:" + parameter + ")").join("|");
        sql.replace(new RegExp(keys, "g"), (key: string) => {
            const value = parameters[key.substr(1)];
            if (value instanceof Array) {
                return value.map((v: any) => {
                    builtParameters.push(v);
                });
            } else {
                builtParameters.push(value);
            }
            return "?";
        }); // todo: make replace only in value statements, otherwise problems
        return builtParameters;
    }

    replaceParameters(sql: string, parameters: ObjectLiteral) {
        if (!parameters || !Object.keys(parameters).length)
            return sql;
        const builtParameters: any[] = [];
        const keys = Object.keys(parameters).map(parameter => "(:" + parameter + ")").join("|");
        sql = sql.replace(new RegExp(keys, "g"), (key: string) => {
            const value = parameters[key.substr(1)];
            if (value instanceof Array) {
                return value.map((v: any) => {
                    builtParameters.push(v);
                    return "$" + builtParameters.length;
                });
            } else {
                builtParameters.push(value);
            }
            return "$" + builtParameters.length;
        });
        return sql;
    }

    /**
     * Insert a new row into given table.
     */
    insert(dbConnection: DatabaseConnection, tableName: string, keyValues: ObjectLiteral, idColumnName?: string): Promise<any> {
        this.checkIfConnectionSet();

        const columns = Object.keys(keyValues).join("\", \"");
        const values  = Object.keys(keyValues).map((key, index) => "$" + (index + 1)).join(","); // todo: escape here
        const params  = Object.keys(keyValues).map(key => keyValues[key]);
        let query   = `INSERT INTO "${tableName}"("${columns}") VALUES (${values})`;
        if (idColumnName) {
            query += " RETURNING " + idColumnName;
        }
        return this.query<any>(dbConnection, query, params).then(result => {
            if (idColumnName)
                return result[0][idColumnName];

            return undefined;
        });
    }

    /**
     * Updates rows that match given conditions in the given table.
     */
    async update(dbConnection: DatabaseConnection, tableName: string, valuesMap: ObjectLiteral, conditions: ObjectLiteral): Promise<void> {
        this.checkIfConnectionSet();

        const updateValues = this.parametrizeObjectMap(valuesMap).join(", ");
        const conditionString = this.parametrizeObjectMap(conditions, Object.keys(valuesMap).length).join(" AND ");
        const updateParams = Object.keys(valuesMap).map(key => valuesMap[key]);
        const conditionParams = Object.keys(conditions).map(key => conditions[key]);
        const query = `UPDATE "${tableName}" SET ${updateValues} ${conditionString ? (" WHERE " + conditionString) : ""}`;
        // console.log("executing update: ", query);
        await this.query(dbConnection, query, updateParams.concat(conditionParams));
    }

    /**
     * Deletes from the given table by a given conditions.
     */
    async delete(dbConnection: DatabaseConnection, tableName: string, conditions: ObjectLiteral): Promise<void> {
        this.checkIfConnectionSet();

        const conditionString = this.parametrizeObjectMap(conditions).join(" AND ");
        const params = Object.keys(conditions).map(key => conditions[key]);

        const query = `DELETE FROM "${tableName}" WHERE ${conditionString}`;
        await this.query(dbConnection, query, params);
    }


    // -------------------------------------------------------------------------
    // Protected Methods
    // -------------------------------------------------------------------------

    protected parametrizeObjectMap(objectMap: ObjectLiteral, startIndex: number = 0): string[] {
        return Object.keys(objectMap).map((key, index) => {
            const value = (objectMap as any)[key];
            // if (value === null || value === undefined) { // todo: I think we dont really need this
            //     return key + "=NULL";
            // } else {
                return "\"" + key + "\"=$" + (startIndex + index + 1);
            // }
        });
    }

    protected checkIfConnectionSet() {
        if (!this.databaseConnection && !this.pool)
            throw new ConnectionIsNotSetError("postgres");
    }

}