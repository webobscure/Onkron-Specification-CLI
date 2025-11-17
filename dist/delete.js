const mysql = require("mysql2");

const connection = mysql.createConnection({
  host: process.env.host,
  user: process.env.user,
  database: process.env.database,
  password: process.env.password,
});

connection.connect((err) => {
    if (err) throw err;
    console.log('Успешное подключение к БД!');
   let sql = `DELETE FROM products_specifications WHERE specifications_id = 61 AND language_id = 6`
    connection.query(sql, (err, results) => {
        console.log(results)
        }
      )
    }
)
